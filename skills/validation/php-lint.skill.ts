/**
 * PHP Lint Skill.
 *
 * Runs `php -l` on every PHP file and reports syntax errors.
 * This is the fastest, zero-dependency validation step.
 */

import type {
  GenerationContext,
  ValidationResult,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { listFilesSafe } from "../../src/core/fs.js";
import { execSafeAsync, commandExists } from "../../src/core/exec.js";

export interface PhpLintResult {
  passed: string[];
  failed: Array<{ file: string; error: string }>;
  phpAvailable: boolean;
}

export class PhpLintSkill extends BaseSkill<void, PhpLintResult> {
  readonly name = "validation/php-lint";
  readonly description = "Runs php -l on all PHP files to catch syntax errors";
  readonly version = "1.0.0";

  validators = [
    (output: PhpLintResult): ValidationResult => ({
      valid: output.failed.length === 0 && output.phpAvailable,
      errors: output.failed.map((f) => ({
        file: f.file,
        message: `PHP syntax error: ${f.error.split("\n")[0]}`,
        severity: "error" as const,
      })),
      warnings: !output.phpAvailable
        ? [{ file: "system", message: "php binary not found — skipping lint", severity: "warning" as const }]
        : [],
    }),
  ];

  async execute(
    _input: void,
    ctx: GenerationContext,
  ): Promise<SkillResult<PhpLintResult>> {
    const start = Date.now();
    this.logs = [];

    const phpAvailable = commandExists("php");
    if (!phpAvailable) {
      this.log("php binary not found — skipping lint");
      return this.buildResult(
        true, // Don't fail the pipeline if php isn't installed locally
        { passed: [], failed: [], phpAvailable: false },
        start,
        0,
        undefined,
        ["php binary not found — install PHP to enable lint checks"],
      );
    }

    const allFiles = await listFilesSafe(ctx.workspacePath);
    const phpFiles = allFiles.filter(
      (f) => f.endsWith(".php") && !f.includes(".router.php"),
    );

    if (phpFiles.length === 0) {
      this.log("No PHP files found");
      return this.buildResult(true, { passed: [], failed: [], phpAvailable }, start);
    }

    this.log(`Linting ${phpFiles.length} PHP file(s)…`);

    const results = await Promise.all(
      phpFiles.map(async (phpFile) => {
        const result = await execSafeAsync(
          `php -l "${phpFile}"`,
          ctx.workspacePath,
          15_000,
        );
        return { phpFile, result };
      }),
    );

    const passed: string[] = [];
    const failed: Array<{ file: string; error: string }> = [];

    for (const { phpFile, result } of results) {
      if (result.success) {
        passed.push(phpFile);
      } else {
        failed.push({ file: phpFile, error: result.stdout + result.stderr });
        this.log(`FAIL: ${phpFile} — ${result.stdout.split("\n")[0]}`);
      }
    }

    this.log(`PHP lint: ${passed.length} passed, ${failed.length} failed`);

    return this.buildResult(
      failed.length === 0,
      { passed, failed, phpAvailable },
      start,
    );
  }
}

export const phpLintSkill = new PhpLintSkill();
