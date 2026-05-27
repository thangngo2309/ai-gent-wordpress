/**
 * Validator Agent.
 *
 * Orchestrates all validation skills (PHP lint → PHPCS → PHPStan →
 * WP Standards → WordPress Validator → Woo) and returns a consolidated
 * validation report.
 */

import type { AgentResult, GenerationContext, ValidationResult } from "../contracts/types.js";
import { phpLintSkill } from "../../skills/validation/php-lint.skill.js";
import { phpcsSkill } from "../../skills/validation/phpcs.skill.js";
import { phpstanSkill } from "../../skills/validation/phpstan.skill.js";
import { wpStandardSkill } from "../../skills/validation/wp-standard.skill.js";
import { wordpressValidatorSkill } from "../../skills/wordpress/validator.skill.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("validator-agent");

export interface ValidationReport {
  qualityScore: number;
  passed: boolean;
  phpLint: { passed: boolean; errorCount: number };
  phpcs: { available: boolean; errorCount: number };
  phpstan: { available: boolean; issueCount: number };
  wpStandard: { errorCount: number };
  wpValidator: { score: number; issueCount: number };
  summary: string;
}

export async function validatorAgent(
  genCtx: GenerationContext,
): Promise<AgentResult<ValidationReport>> {
  const start = Date.now();
  log.info("Starting validation pipeline…");

  // Run PHP lint
  const lintResult = await phpLintSkill.execute(undefined, genCtx);
  const lintErrors = lintResult.data?.failed.length ?? 0;
  log.info(`PHP lint: ${lintErrors} error(s)`);

  // If lint fails, skip deeper analysis
  if (!lintResult.success && lintErrors > 0) {
    log.warn("PHP syntax errors found — skipping further analysis");
    return {
      success: false,
      data: {
        qualityScore: 0,
        passed: false,
        phpLint: { passed: false, errorCount: lintErrors },
        phpcs: { available: false, errorCount: 0 },
        phpstan: { available: false, issueCount: 0 },
        wpStandard: { errorCount: 0 },
        wpValidator: { score: 0, issueCount: 0 },
        summary: `PHP syntax errors in ${lintErrors} file(s) — fix before proceeding`,
      },
    };
  }

  // Run PHPCS (non-blocking if unavailable)
  const phpcsResult = await phpcsSkill.execute({ standard: "WordPress" }, genCtx);
  const phpcsErrors = phpcsResult.data?.violations.filter((v) => v.severity === "error").length ?? 0;

  // Run PHPStan (non-blocking if unavailable)
  const phpstanResult = await phpstanSkill.execute({ level: 5 }, genCtx);
  const phpstanIssues = phpstanResult.data?.violations.length ?? 0;

  // Run WordPress Standards checks
  const wpStdResult = await wpStandardSkill.execute(undefined, genCtx);
  const wpStdErrors = wpStdResult.data?.violations.filter((v) => v.severity === "error").length ?? 0;

  // Run composite WP validator (hooks, enqueue, security, i18n)
  const wpValidatorResult = await wordpressValidatorSkill.execute(undefined, genCtx);
  const wpScore = wpValidatorResult.data?.score ?? 50;
  const wpIssues = (wpValidatorResult.data?.structureErrors.length ?? 0) +
    (wpValidatorResult.data?.hookIssues.length ?? 0) +
    (wpValidatorResult.data?.enqueueIssues.length ?? 0) +
    (wpValidatorResult.data?.securityIssues.length ?? 0);

  // Compute aggregate quality score
  const qualityScore = Math.round(
    wpScore * 0.4 +
    (phpcsErrors === 0 ? 100 : Math.max(0, 100 - phpcsErrors * 5)) * 0.2 +
    (phpstanIssues === 0 ? 100 : Math.max(0, 100 - phpstanIssues * 5)) * 0.2 +
    (wpStdErrors === 0 ? 100 : Math.max(0, 100 - wpStdErrors * 10)) * 0.2,
  );

  const passed = lintErrors === 0 && phpcsErrors === 0 && wpStdErrors === 0;

  const summary = [
    `Quality score: ${qualityScore}/100`,
    `PHP lint: ${lintErrors === 0 ? "✓ passed" : `✗ ${lintErrors} error(s)`}`,
    `PHPCS: ${phpcsResult.data?.available ? (phpcsErrors === 0 ? "✓ passed" : `✗ ${phpcsErrors} error(s)`) : "⚠ not installed"}`,
    `PHPStan: ${phpstanResult.data?.available ? (phpstanIssues === 0 ? "✓ passed" : `⚠ ${phpstanIssues} issue(s)`) : "⚠ not installed"}`,
    `WP Standards: ${wpStdErrors === 0 ? "✓ passed" : `✗ ${wpStdErrors} error(s)`}`,
    `WP Validator: score ${wpScore}/100, ${wpIssues} issue(s)`,
  ].join("\n");

  log.info(summary);

  return {
    success: passed,
    data: {
      qualityScore,
      passed,
      phpLint: { passed: lintErrors === 0, errorCount: lintErrors },
      phpcs: { available: phpcsResult.data?.available ?? false, errorCount: phpcsErrors },
      phpstan: { available: phpstanResult.data?.available ?? false, issueCount: phpstanIssues },
      wpStandard: { errorCount: wpStdErrors },
      wpValidator: { score: wpScore, issueCount: wpIssues },
      summary,
    },
  };
}
