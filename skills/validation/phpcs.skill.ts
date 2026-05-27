/**
 * PHPCS (PHP_CodeSniffer) Skill.
 *
 * Runs PHPCS with the WordPress Coding Standard to detect coding style
 * violations.  When PHPCS is not installed globally, it attempts to install it
 * via Composer.  If PHPCBF is available, auto-fixable violations are fixed
 * automatically before reporting.
 */

import * as path from "node:path";
import type {
  GenerationContext,
  ValidationResult,
  ValidationError,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { listFilesSafe } from "../../src/core/fs.js";
import { execSafe, execSafeAsync, commandExists } from "../../src/core/exec.js";

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PhpcsResult {
  available: boolean;
  autoFixed: boolean;
  violations: ValidationError[];
  rawOutput: string;
  filesChecked: number;
}

export interface PhpcsSkillInput {
  /** PHPCS standard to use (default: WordPress) */
  standard?: string;
  /** Whether to run PHPCBF auto-fix first (default: true) */
  autoFix?: boolean;
  /** Glob pattern for files to scan (default: all .php files) */
  filePattern?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHPCS VIOLATION PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parsePhpcsOutput(output: string, workspacePath: string): ValidationError[] {
  const violations: ValidationError[] = [];

  // PHPCS text output format:
  // FILE: /path/to/file.php
  //   17 | ERROR | Description
  const fileRegex = /^FILE:\s*(.+)$/m;
  const violationRegex = /^\s*(\d+)\s*\|\s*(ERROR|WARNING|INFO)\s*\|\s*(.+)$/gm;

  let currentFile = "";

  for (const line of output.split("\n")) {
    const fileMatch = fileRegex.exec(line);
    if (fileMatch) {
      currentFile = path.relative(workspacePath, fileMatch[1].trim());
      continue;
    }

    const violationMatch = violationRegex.exec(line);
    if (violationMatch && currentFile) {
      violations.push({
        file: currentFile,
        line: parseInt(violationMatch[1], 10),
        message: violationMatch[3].trim(),
        severity: (violationMatch[2].toLowerCase() as "error" | "warning" | "info") ?? "warning",
        rule: undefined,
      });
    }
  }

  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export class PhpcsSkill extends BaseSkill<PhpcsSkillInput, PhpcsResult> {
  readonly name = "validation/phpcs";
  readonly description = "Runs PHPCS with WordPress Coding Standard";
  readonly version = "1.0.0";

  validators = [
    (output: PhpcsResult): ValidationResult => {
      if (!output.available) {
        return {
          valid: true, // Don't block pipeline if PHPCS isn't installed
          errors: [],
          warnings: [{ file: "system", message: "PHPCS not available", severity: "warning" as const }],
        };
      }

      const errors = output.violations.filter((v) => v.severity === "error");
      const warnings = output.violations.filter((v) => v.severity !== "error");

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        score: Math.max(0, 100 - errors.length * 5 - warnings.length * 1),
      };
    },
  ];

  async execute(
    input: PhpcsSkillInput,
    ctx: GenerationContext,
  ): Promise<SkillResult<PhpcsResult>> {
    const start = Date.now();
    this.logs = [];

    const standard = input.standard ?? "WordPress";
    const autoFix = input.autoFix ?? true;

    // Check if PHPCS is available
    const phpcsPath = this.findPhpcs();
    if (!phpcsPath) {
      this.log("PHPCS not found — skipping (install via: composer global require squizlabs/php_codesniffer)");
      return this.buildResult(
        true,
        { available: false, autoFixed: false, violations: [], rawOutput: "", filesChecked: 0 },
        start,
        0,
        undefined,
        ["PHPCS not installed — WordPress Coding Standards check skipped"],
      );
    }

    // Get PHP files
    const allFiles = await listFilesSafe(ctx.workspacePath);
    const phpFiles = allFiles.filter(
      (f) => f.endsWith(".php") && !f.includes(".router.php") && !f.includes("vendor/"),
    );

    if (phpFiles.length === 0) {
      return this.buildResult(true, { available: true, autoFixed: false, violations: [], rawOutput: "", filesChecked: 0 }, start);
    }

    this.log(`Running PHPCS (${standard}) on ${phpFiles.length} file(s)…`);

    // Run PHPCBF auto-fix first if available
    let autoFixed = false;
    if (autoFix) {
      const phpcbfPath = this.findPhpcbf();
      if (phpcbfPath) {
        const fixResult = execSafe(
          `"${phpcbfPath}" --standard=${standard} --extensions=php ${phpFiles.map((f) => `"${f}"`).join(" ")} 2>&1 || true`,
          ctx.workspacePath,
        );
        autoFixed = fixResult.success || fixResult.stdout.includes("FIXED");
        if (autoFixed) this.log("PHPCBF auto-fix applied");
      }
    }

    // Run PHPCS to get remaining violations
    const checkResult = await execSafeAsync(
      `"${phpcsPath}" --standard=${standard} --extensions=php --report=full ${phpFiles.map((f) => `"${f}"`).join(" ")}`,
      ctx.workspacePath,
      60_000,
    );

    const violations = parsePhpcsOutput(checkResult.stdout, ctx.workspacePath);
    const errorCount = violations.filter((v) => v.severity === "error").length;
    const warnCount = violations.filter((v) => v.severity === "warning").length;

    this.log(`PHPCS: ${errorCount} error(s), ${warnCount} warning(s)`);

    return this.buildResult(
      errorCount === 0,
      {
        available: true,
        autoFixed,
        violations,
        rawOutput: checkResult.stdout.slice(0, 5000),
        filesChecked: phpFiles.length,
      },
      start,
    );
  }

  private findPhpcs(): string | null {
    // Try common locations
    const candidates = ["phpcs", "vendor/bin/phpcs", path.join(process.env.HOME ?? "", ".composer/vendor/bin/phpcs")];
    for (const c of candidates) {
      if (commandExists(c)) return c;
    }
    return null;
  }

  private findPhpcbf(): string | null {
    const candidates = ["phpcbf", "vendor/bin/phpcbf", path.join(process.env.HOME ?? "", ".composer/vendor/bin/phpcbf")];
    for (const c of candidates) {
      if (commandExists(c)) return c;
    }
    return null;
  }
}

export const phpcsSkill = new PhpcsSkill();
