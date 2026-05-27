/**
 * WordPress Plugin Generation Skill.
 *
 * Generates a complete, upload-ready WordPress plugin from a GenerationContext.
 */

import type {
  GenerationContext,
  GeneratedFile,
  FileSpec,
  ValidationResult,
} from "../../src/contracts/types.js";
import {
  BaseSkill,
  type SkillResult,
} from "../../src/contracts/skill.js";
import { getDefaultLlmClient } from "../../src/core/llm.js";
import { writeFileSafe } from "../../src/core/fs.js";
import { buildPluginBatchPrompt } from "../../src/prompts/generation.js";

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot"]);

const SEED_BATCH_FILES = [
  "includes/class-loader.php",
  "includes/class-plugin.php",
  "includes/class-security.php",
  "includes/class-activator.php",
  "includes/class-deactivator.php",
];

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginSkillInput {
  fileStructure: FileSpec[];
  pluginMainFile: string;
  batchSize?: number;
}

export type PluginSkillOutput = GeneratedFile[];

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export class PluginSkill extends BaseSkill<PluginSkillInput, PluginSkillOutput> {
  readonly name = "wordpress/plugin";
  readonly description = "Generates a complete, upload-ready WordPress plugin";
  readonly version = "1.0.0";

  validators = [
    (files: PluginSkillOutput, ctx: GenerationContext): ValidationResult => {
      const paths = new Set(files.map((f) => f.filePath));
      const required = [
        ctx.spec?.fileStructure.find((f) => f.filePath.endsWith(".php") && !f.filePath.includes("/"))?.filePath ?? `${ctx.projectSlug}.php`,
        "uninstall.php",
        "readme.txt",
      ];
      const missing = required.filter((f) => !paths.has(f));
      return {
        valid: missing.length === 0,
        errors: missing.map((f) => ({
          file: f,
          message: `Required plugin file missing: ${f}`,
          severity: "error" as const,
        })),
        warnings: [],
      };
    },

    (files: PluginSkillOutput, ctx: GenerationContext): ValidationResult => {
      const mainFile = files.find(
        (f) => f.filePath === `${ctx.projectSlug}.php` || (f.filePath.endsWith(".php") && !f.filePath.includes("/")),
      );
      if (!mainFile) return { valid: true, errors: [], warnings: [] };

      const errors = [];
      if (!mainFile.content.includes("Plugin Name:")) {
        errors.push({
          file: mainFile.filePath,
          message: "Missing WordPress plugin header (Plugin Name: ...)",
          severity: "error" as const,
        });
      }
      if (!mainFile.content.includes("register_activation_hook")) {
        errors.push({
          file: mainFile.filePath,
          message: "Missing register_activation_hook()",
          severity: "warning" as const,
        });
      }
      return { valid: errors.filter((e) => e.severity === "error").length === 0, errors, warnings: [] };
    },
  ];

  async execute(
    input: PluginSkillInput,
    ctx: GenerationContext,
  ): Promise<SkillResult<PluginSkillOutput>> {
    const start = Date.now();
    this.logs = [];

    const { fileStructure, pluginMainFile, batchSize = 4 } = input;

    const textFiles = fileStructure
      .filter((f) => !BINARY_EXTS.has(f.filePath.slice(f.filePath.lastIndexOf(".")).toLowerCase()))
      .sort((a, b) => priorityOrder(a.filePath, pluginMainFile) - priorityOrder(b.filePath, pluginMainFile));

    const batches = buildPluginBatches(textFiles, pluginMainFile, batchSize);
    this.log(`Generating ${textFiles.length} plugin files in ${batches.length} batch(es)`);

    const allFiles: GeneratedFile[] = [];
    const llm = getDefaultLlmClient();

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const existingContext = buildExistingContext(allFiles);
      const prompt = buildPluginBatchPrompt(ctx, batch, i, batches.length, existingContext, pluginMainFile);

      this.log(`Batch ${i + 1}/${batches.length}: ${batch.map((f) => f.filePath).join(", ")}`);

      try {
        const result = (await llm.complete(prompt, { maxTokens: 16384 })) as GeneratedFile[];
        const files = Array.isArray(result) ? result : [result];
        allFiles.push(...files);
        this.log(`Batch ${i + 1} done: ${files.length} file(s)`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return this.buildResult(false, [], start, i, `Batch ${i + 1} failed: ${msg}`);
      }
    }

    for (const file of allFiles) {
      await writeFileSafe(ctx.workspacePath, file.filePath, file.content);
    }

    this.log(`Plugin generation complete: ${allFiles.length} files`);
    return this.buildResult(true, allFiles, start);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function priorityOrder(fp: string, mainFile: string): number {
  if (fp === mainFile) return 0;
  if (fp.startsWith("includes/")) return 1;
  if (fp.startsWith("admin/") || fp.startsWith("public/")) return 2;
  if (fp.startsWith("templates/")) return 3;
  if (fp === "uninstall.php" || fp === "readme.txt") return 4;
  if (fp.startsWith("assets/")) return 5;
  if (fp.startsWith("languages/")) return 6;
  return 7;
}

function buildPluginBatches(
  files: FileSpec[],
  mainFile: string,
  batchSize: number,
): FileSpec[][] {
  const seedPaths = new Set([mainFile, ...SEED_BATCH_FILES]);
  const seed = files.filter((f) => seedPaths.has(f.filePath));
  const remaining = files.filter((f) => !seedPaths.has(f.filePath));

  const batches: FileSpec[][] = [];
  if (seed.length > 0) batches.push(seed);
  for (let i = 0; i < remaining.length; i += batchSize) {
    batches.push(remaining.slice(i, i + batchSize));
  }
  return batches;
}

function buildExistingContext(files: GeneratedFile[]): string {
  if (files.length === 0) return "";
  const snippets = files.map((f) => {
    const limit = 800;
    return `--- ${f.filePath} ---\n${f.content.slice(0, limit)}${f.content.length > limit ? "\n…(truncated)" : ""}`;
  });
  return `\nAlready generated files (reference only — do NOT regenerate):\n${snippets.join("\n")}\n`;
}

export const pluginSkill = new PluginSkill();
