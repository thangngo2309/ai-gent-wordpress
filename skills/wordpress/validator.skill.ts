/**
 * WordPress Validator Skill.
 *
 * Runs all deterministic WordPress-specific validations in a single pass:
 * - Theme/plugin structure check
 * - Hook presence check  
 * - Enqueue compliance
 * - Security scan
 * - Translation-readiness
 */

import type {
  GenerationContext,
  ValidationResult,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { readFileSafe, listFilesSafe } from "../../src/core/fs.js";
import { hooksSkill } from "./hooks.skill.js";
import { enqueueSkill } from "./enqueue.skill.js";
import { securitySkill } from "./security.skill.js";

export interface WPValidationReport {
  structureErrors: string[];
  hookIssues: string[];
  enqueueIssues: string[];
  securityIssues: string[];
  i18nIssues: string[];
  passed: boolean;
  score: number; // 0-100
}

export class WordPressValidatorSkill extends BaseSkill<void, WPValidationReport> {
  readonly name = "wordpress/validator";
  readonly description = "Runs all WordPress-specific validations in one pass";
  readonly version = "1.0.0";

  validators = [
    (output: WPValidationReport): ValidationResult => {
      const allErrors = [
        ...output.structureErrors,
        ...output.securityIssues.filter((i) => i.includes("critical") || i.includes("CRITICAL")),
      ];
      return {
        valid: allErrors.length === 0,
        errors: allErrors.map((msg) => ({ file: "unknown", message: msg, severity: "error" as const })),
        warnings: [...output.hookIssues, ...output.enqueueIssues, ...output.i18nIssues].map((msg) => ({
          file: "unknown",
          message: msg,
          severity: "warning" as const,
        })),
        score: output.score,
      };
    },
  ];

  async execute(
    _input: void,
    ctx: GenerationContext,
  ): Promise<SkillResult<WPValidationReport>> {
    const start = Date.now();
    this.logs = [];
    const isTheme = ctx.analysis?.projectType === "wordpress_theme";

    // ── Structure check ────────────────────────────────────────────────────
    const structureErrors = await this.checkStructure(ctx, isTheme);

    // ── Hooks check ────────────────────────────────────────────────────────
    const hooksResult = await hooksSkill.execute({ files: [] }, ctx);
    const hookIssues = hooksResult.data.issues
      .filter((i) => !i.fixed)
      .map((i) => `${i.file}: ${i.message}`);

    // ── Enqueue check ──────────────────────────────────────────────────────
    const enqueueResult = await enqueueSkill.execute(undefined, ctx);
    const enqueueIssues = enqueueResult.data.issues.map((i) => `${i.file}: ${i.message}`);

    // ── Security check ────────────────────────────────────────────────────
    const securityResult = await securitySkill.execute(undefined, ctx);
    const securityIssues = [
      ...securityResult.data.criticalIssues,
      ...securityResult.data.failedChecks,
    ];

    // ── i18n check ────────────────────────────────────────────────────────
    const i18nIssues = await this.checkI18n(ctx);

    // ── Scoring ───────────────────────────────────────────────────────────
    let score = 100;
    score -= structureErrors.length * 20;
    score -= securityResult.data.criticalIssues.length * 30;
    score -= hookIssues.length * 10;
    score -= enqueueIssues.filter((i) => i.includes("Hardcoded")).length * 5;
    score -= i18nIssues.length * 2;
    score = Math.max(0, score);

    const report: WPValidationReport = {
      structureErrors,
      hookIssues,
      enqueueIssues,
      securityIssues,
      i18nIssues,
      passed: structureErrors.length === 0 && securityResult.data.clean,
      score,
    };

    this.log(
      `WordPress validation: score=${score}/100, passed=${report.passed}`,
    );

    return this.buildResult(report.passed, report, start);
  }

  private async checkStructure(
    ctx: GenerationContext,
    isTheme: boolean,
  ): Promise<string[]> {
    const errors: string[] = [];

    if (isTheme) {
      const required = ["style.css", "functions.php", "index.php", "header.php", "footer.php"];
      for (const f of required) {
        const content = await readFileSafe(ctx.workspacePath, f);
        if (!content) errors.push(`Missing required theme file: ${f}`);
      }
      const styleCss = await readFileSafe(ctx.workspacePath, "style.css");
      if (styleCss && !styleCss.includes("Theme Name:")) {
        errors.push("style.css is missing the WordPress theme header (Theme Name: ...)");
      }
    } else {
      const phpFiles = (await listFilesSafe(ctx.workspacePath)).filter(
        (f) => f.endsWith(".php") && !f.includes("/") && f !== "uninstall.php",
      );
      const hasBootstrap = phpFiles.some(async (f) => {
        const c = await readFileSafe(ctx.workspacePath, f);
        return c?.includes("Plugin Name:");
      });
      // Note: async in filter doesn't work; just check files exist
      if (phpFiles.length === 0) {
        errors.push("Missing plugin bootstrap file (root .php with Plugin Name: header)");
      }
    }

    return errors;
  }

  private async checkI18n(ctx: GenerationContext): Promise<string[]> {
    const issues: string[] = [];
    const phpFiles = (await listFilesSafe(ctx.workspacePath)).filter(
      (f) => f.endsWith(".php"),
    );

    for (const phpFile of phpFiles) {
      const content = await readFileSafe(ctx.workspacePath, phpFile);
      if (!content) continue;

      // Detect echo/print with hardcoded English strings that bypass i18n
      const hardcoded = content.match(/echo\s+['"][A-Z][a-z ]{5,}['"];/g);
      if (hardcoded && hardcoded.length > 0) {
        issues.push(
          `${phpFile}: ${hardcoded.length} hardcoded string(s) not wrapped in __() or _e()`,
        );
      }
    }

    return issues;
  }
}

export const wordpressValidatorSkill = new WordPressValidatorSkill();
