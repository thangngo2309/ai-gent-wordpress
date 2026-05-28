/**
 * WordPress Theme Generation Skill.
 *
 * Generates a complete, upload-ready WordPress theme from a GenerationContext.
 * Wraps the theme-specific logic that was previously inline in agent.ts
 * codeGenerator(), making it independently testable and reusable.
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
import { buildThemeBatchPrompt } from "../../src/prompts/generation.js";

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_THEME_FILES = [
  "style.css",
  "functions.php",
  "index.php",
  "header.php",
  "footer.php",
  "inc/theme-data.php",
  "inc/customizer.php",
];

const SEED_BATCH_FILES = new Set([
  "functions.php",
  "inc/theme-data.php",
  "inc/customizer.php",
]);

const SEED_BATCH_2_FILES = new Set([
  "header.php",
  "footer.php",
  "front-page.php",
]);

const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".eot"]);

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL INPUT / OUTPUT
// ─────────────────────────────────────────────────────────────────────────────

export interface ThemeSkillInput {
  /** File list from ProjectSpec */
  fileStructure: FileSpec[];
  /** Override batch size (default: 4) */
  batchSize?: number;
}

export type ThemeSkillOutput = GeneratedFile[];

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export class ThemeSkill extends BaseSkill<ThemeSkillInput, ThemeSkillOutput> {
  readonly name = "wordpress/theme";
  readonly description = "Generates a complete, upload-ready WordPress theme";
  readonly version = "1.0.0";

  // ── Validators ────────────────────────────────────────────────────────────

  validators = [
    (files: ThemeSkillOutput): ValidationResult => {
      const paths = new Set(files.map((f) => f.filePath));
      const missing = REQUIRED_THEME_FILES.filter((f) => !paths.has(f));
      if (missing.length > 0) {
        return {
          valid: false,
          errors: missing.map((f) => ({
            file: f,
            message: `Required theme file missing: ${f}`,
            severity: "error" as const,
          })),
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },

    (files: ThemeSkillOutput): ValidationResult => {
      const styleCss = files.find((f) => f.filePath === "style.css");
      if (!styleCss) return { valid: true, errors: [], warnings: [] };

      const errors = [];
      if (!styleCss.content.includes("Theme Name:")) {
        errors.push({
          file: "style.css",
          message: "Missing WordPress theme header (Theme Name: ...)",
          severity: "error" as const,
        });
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
  ];

  // ── Execute ───────────────────────────────────────────────────────────────

  async execute(
    input: ThemeSkillInput,
    ctx: GenerationContext,
  ): Promise<SkillResult<ThemeSkillOutput>> {
    const start = Date.now();
    this.logs = [];

    const { fileStructure, batchSize = 4 } = input;
    const actualPrefix = ctx.phpPrefix;

    // Separate binary from text files
    const binaryFiles = fileStructure.filter((f) =>
      BINARY_EXTS.has(f.filePath.slice(f.filePath.lastIndexOf(".")).toLowerCase()),
    );
    const textFiles = fileStructure
      .filter((f) => !BINARY_EXTS.has(f.filePath.slice(f.filePath.lastIndexOf(".")).toLowerCase()))
      .sort((a, b) => priorityOrder(a.filePath) - priorityOrder(b.filePath));

    // Handle binary placeholders
    for (const bf of binaryFiles) {
      if (bf.filePath === "screenshot.png") {
        await import("node:fs").then(({ promises }) =>
          promises.mkdir(ctx.workspacePath, { recursive: true }).then(() =>
            promises.writeFile(`${ctx.workspacePath}/${bf.filePath}`, PLACEHOLDER_PNG),
          ),
        );
        this.log(`Placeholder: ${bf.filePath}`);
      } else {
        this.log(`Skipping binary: ${bf.filePath}`);
      }
    }

    // Build batches
    const batches = buildThemeBatches(textFiles, batchSize);
    this.log(`Generating ${textFiles.length} files in ${batches.length} batch(es)`);

    const allFiles: GeneratedFile[] = [];
    const llm = getDefaultLlmClient();

    // Seed batches run sequentially so subsequent batches have context
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      // Use design system CSS vars from context as the seed for early batches
      // (before style.css is generated).  extractCssVarsBlock returns "" until
      // style.css lands in allFiles, so ctx.designSystemCssVars fills the gap.
      const cssVarsBlock = extractCssVarsBlock(allFiles) || ctx.designSystemCssVars || "";
      const existingContext = buildExistingContext(allFiles);

      const prompt = buildThemeBatchPrompt(
        ctx,
        batch,
        i,
        batches.length,
        existingContext,
        cssVarsBlock,
        actualPrefix,
      );

      this.log(`Batch ${i + 1}/${batches.length}: ${batch.map((f) => f.filePath).join(", ")}`);

      try {
        const result = (await llm.complete(prompt, { maxTokens: 32000 })) as GeneratedFile[];
        const files = Array.isArray(result) ? result : [result];
        allFiles.push(...files);
        this.log(`Batch ${i + 1} done: ${files.length} file(s)`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`Batch ${i + 1} failed: ${msg}`);
        return this.buildResult(false, [], start, i, `Batch ${i + 1} failed: ${msg}`);
      }
    }

    // Write files to disk
    for (const file of allFiles) {
      await writeFileSafe(ctx.workspacePath, file.filePath, file.content);
    }

    this.log(`Theme generation complete: ${allFiles.length} files written`);
    return this.buildResult(true, allFiles, start);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function priorityOrder(fp: string): number {
  if (fp === "style.css") return 10; // deferred — generated last with full CSS context
  if (fp === "functions.php") return 0;
  if (fp.includes("inc/")) return 1;
  if (fp === "header.php" || fp === "footer.php") return 2;
  if (["front-page.php", "index.php", "page.php", "single.php", "404.php", "archive.php"].includes(fp)) return 3;
  if (fp.includes("template-parts/")) return 4;
  if (fp.includes("assets/")) return 5;
  return 6;
}

function buildThemeBatches(
  files: FileSpec[],
  batchSize: number,
): FileSpec[][] {
  const seed1 = files.filter((f) => SEED_BATCH_FILES.has(f.filePath));
  const seed2 = files.filter((f) => SEED_BATCH_2_FILES.has(f.filePath));
  const deferred = files.filter((f) => f.filePath === "style.css");
  const remaining = files.filter(
    (f) => !SEED_BATCH_FILES.has(f.filePath) && !SEED_BATCH_2_FILES.has(f.filePath) && f.filePath !== "style.css",
  );

  const batches: FileSpec[][] = [];
  if (seed1.length > 0) batches.push(seed1);
  if (seed2.length > 0) batches.push(seed2);

  for (let i = 0; i < remaining.length; i += batchSize) {
    batches.push(remaining.slice(i, i + batchSize));
  }

  if (deferred.length > 0) batches.push(deferred);
  return batches;
}

function extractCssVarsBlock(files: GeneratedFile[]): string {
  const styleCss = files.find((f) => f.filePath === "style.css");
  if (!styleCss) return "";
  const rootMatch = styleCss.content.match(/:root\s*\{[^}]+\}/);
  if (!rootMatch) return "";
  const varNames = [...rootMatch[0].matchAll(/--[\w-]+/g)].map((m) => m[0]);
  if (varNames.length === 0) return "";
  const compact = varNames.join(", ").slice(0, 1500);
  return `\n⚠️  CSS variables defined in style.css (use ONLY these):\n${compact}\n`;
}

function buildExistingContext(files: GeneratedFile[]): string {
  if (files.length === 0) return "";
  const snippets = files.map((f) => {
    const limit = f.filePath === "style.css" ? 4000 : f.filePath.includes("inc/") ? 3000 : f.filePath.includes("template-parts/") ? 1500 : 800;
    return `--- ${f.filePath} ---\n${f.content.slice(0, limit)}${f.content.length > limit ? "\n…(truncated)" : ""}`;
  });
  return `\nAlready generated files (reference only — do NOT regenerate):\n${snippets.join("\n")}\n`;
}

/** Default export for registry */
export const themeSkill = new ThemeSkill();
