/**
 * WordPress Enqueue Skill.
 *
 * Validates that scripts and styles are enqueued via WordPress APIs
 * (wp_enqueue_script / wp_enqueue_style) rather than hardcoded <script>/<link> tags.
 */

import type {
  GenerationContext,
  ValidationResult,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { readFileSafe, listFilesSafe } from "../../src/core/fs.js";

export interface EnqueueIssue {
  file: string;
  line?: number;
  type: "hardcoded_script" | "hardcoded_style" | "missing_enqueue";
  message: string;
}

export interface EnqueueSkillOutput {
  issues: EnqueueIssue[];
  passed: boolean;
}

export class EnqueueSkill extends BaseSkill<void, EnqueueSkillOutput> {
  readonly name = "wordpress/enqueue";
  readonly description = "Validates WordPress wp_enqueue_script/style usage";
  readonly version = "1.0.0";

  validators = [
    (output: EnqueueSkillOutput): ValidationResult => ({
      valid: output.passed,
      errors: output.issues
        .filter((i) => i.type !== "missing_enqueue")
        .map((i) => ({
          file: i.file,
          line: i.line,
          message: i.message,
          severity: "warning" as const,
        })),
      warnings: output.issues
        .filter((i) => i.type === "missing_enqueue")
        .map((i) => ({
          file: i.file,
          message: i.message,
          severity: "info" as const,
        })),
    }),
  ];

  async execute(
    _input: void,
    ctx: GenerationContext,
  ): Promise<SkillResult<EnqueueSkillOutput>> {
    const start = Date.now();
    this.logs = [];
    const issues: EnqueueIssue[] = [];

    const phpFiles = (await listFilesSafe(ctx.workspacePath)).filter(
      (f) => f.endsWith(".php") && !f.includes("template-parts/"),
    );

    for (const phpFile of phpFiles) {
      const content = await readFileSafe(ctx.workspacePath, phpFile);
      if (!content) continue;

      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        const lineNum = idx + 1;

        // Detect hardcoded <script> tags (outside PHP blocks)
        if (/<script\s+src\s*=/i.test(line) && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")) {
          issues.push({
            file: phpFile,
            line: lineNum,
            type: "hardcoded_script",
            message: `Hardcoded <script src> tag at line ${lineNum}; use wp_enqueue_script() instead`,
          });
        }

        // Detect hardcoded <link rel="stylesheet"> tags
        if (/<link[^>]+rel=["']stylesheet["']/i.test(line) && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")) {
          issues.push({
            file: phpFile,
            line: lineNum,
            type: "hardcoded_style",
            message: `Hardcoded <link rel="stylesheet"> at line ${lineNum}; use wp_enqueue_style() instead`,
          });
        }
      });
    }

    // Check that functions.php actually calls wp_enqueue_script/style
    const functionsPhp = await readFileSafe(ctx.workspacePath, "functions.php");
    if (functionsPhp) {
      if (!functionsPhp.includes("wp_enqueue_style") && !functionsPhp.includes("wp_enqueue_script")) {
        issues.push({
          file: "functions.php",
          type: "missing_enqueue",
          message: "functions.php does not call wp_enqueue_style() or wp_enqueue_script()",
        });
      }
    }

    const criticalIssues = issues.filter(
      (i) => i.type === "hardcoded_script" || i.type === "hardcoded_style",
    );

    const output: EnqueueSkillOutput = {
      issues,
      passed: criticalIssues.length === 0,
    };

    if (issues.length > 0) {
      this.log(`Found ${issues.length} enqueue issue(s)`);
    } else {
      this.log("All assets enqueued correctly via WordPress APIs");
    }

    return this.buildResult(output.passed, output, start);
  }
}

export const enqueueSkill = new EnqueueSkill();
