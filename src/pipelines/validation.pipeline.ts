/**
 * Validation Pipeline.
 *
 * Runs the full validation stack: PHP lint → PHPCS → PHPStan → WP Standards
 * → WordPress Validator → WooCommerce compatibility.
 *
 * Each step is non-blocking by default — a missing tool produces a warning
 * but does not fail the pipeline.  Only PHP syntax errors and WP standards
 * errors are hard failures.
 */

import type { GenerationContext } from "../contracts/types.js";
import { validatorAgent, type ValidationReport } from "../agents/validator.agent.js";
import { wooSkill } from "../../skills/wordpress/woo.skill.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("validation-pipeline");

export interface ValidationPipelineResult {
  passed: boolean;
  qualityScore: number;
  report: ValidationReport;
  wooCompatible: boolean | null;
  durationMs: number;
}

export async function runValidationPipeline(
  genCtx: GenerationContext,
): Promise<ValidationPipelineResult> {
  const start = Date.now();
  log.info("Starting validation pipeline…");

  // Main validator aggregation
  const report = await validatorAgent(genCtx);

  // WooCommerce compatibility (only when relevant)
  let wooCompatible: boolean | null = null;
  const idea = genCtx.idea ?? "";
  const needsWoo = /woocommerce|woo\b|e-?commerce|shop|store|cart|checkout/i.test(idea);

  if (needsWoo) {
    const wooResult = await wooSkill.execute(undefined, genCtx);
    wooCompatible = wooResult.data?.compatible ?? false;
    log.info(`WooCommerce compatibility: ${wooCompatible ? "✓" : "✗"}`);
  }

  const finalPassed = report.success && (wooCompatible === null || wooCompatible);

  log.info(`Pipeline complete — quality ${report.data.qualityScore}/100, passed: ${finalPassed}`);

  return {
    passed: finalPassed,
    qualityScore: report.data.qualityScore,
    report: report.data,
    wooCompatible,
    durationMs: Date.now() - start,
  };
}
