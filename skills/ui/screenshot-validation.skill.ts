/**
 * Screenshot Validation Skill.
 *
 * Extends the existing QA visual pipeline with UI-quality-focused validation.
 * Wraps qaVisualAgent from src/agents/qa-visual.agent.ts — does NOT replace it.
 *
 * Adds:
 * - Design system compliance checks (spacing, typography, color tokens)
 * - Premium UI quality scoring with actionable fix hints
 * - Integration with the current validation pipeline (non-breaking)
 *
 * Usage:
 *   const result = await screenshotValidationSkill.execute({ previewUrl }, ctx);
 */

import type { GenerationContext, ValidationResult } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import {
  qaVisualAgent,
  type QaVisualReport,
  type QaVisualOptions,
} from "../../src/agents/qa-visual.agent.js";

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ScreenshotValidationInput {
  /** URL of running WordPress Playground preview */
  previewUrl: string;
  /** Review round number (default: 1) */
  round?: number;
  /** Page paths to review (default: ["/"] ) */
  pagePaths?: string[];
  /** Passing score threshold 0–100 (default: 75) */
  passScore?: number;
}

export interface ScreenshotValidationOutput {
  passed: boolean;
  overallScore: number;
  reports: QaVisualReport[];
  criticalIssues: string[];
  fixHints: string[];
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  VALIDATORS
// ─────────────────────────────────────────────────────────────────────────────

function buildValidationResult(output: ScreenshotValidationOutput): ValidationResult {
  const errors = output.criticalIssues.map((msg) => ({
    file: "screenshot",
    message: msg,
    severity: "error" as const,
  }));
  return {
    valid: output.passed,
    errors,
    warnings: output.fixHints.map((msg) => ({
      file: "screenshot",
      message: msg,
      severity: "info" as const,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export class ScreenshotValidationSkill extends BaseSkill<
  ScreenshotValidationInput,
  ScreenshotValidationOutput
> {
  readonly name = "ui/screenshot-validation";
  readonly description =
    "Playwright screenshot + Vision AI review for UI quality validation";
  readonly version = "1.0.0";

  validators = [
    (output: ScreenshotValidationOutput): ValidationResult =>
      buildValidationResult(output),
  ];

  async execute(
    input: ScreenshotValidationInput,
    ctx: GenerationContext,
  ): Promise<SkillResult<ScreenshotValidationOutput>> {
    const start = Date.now();
    this.logs = [];

    const {
      previewUrl,
      round = 1,
      pagePaths = ["/"],
      passScore = 75,
    } = input;

    const brandContext = [
      ctx.analysis?.brandName ?? ctx.idea,
      ctx.analysis?.designDirection?.tone,
      ctx.analysis?.designDirection?.colorPalette,
    ]
      .filter(Boolean)
      .join(" — ");

    const reports: QaVisualReport[] = [];
    const criticalIssues: string[] = [];
    const fixHints: string[] = [];

    // Run QA visual review for each requested page path
    for (const pagePath of pagePaths) {
      const pageUrl = pagePath === "/" ? previewUrl : `${previewUrl}${pagePath}`;
      const options: QaVisualOptions = {
        round,
        pagePath,
        passScore,
        brandContext,
      };

      this.log(`Running visual review: ${pageUrl} (round ${round})`);

      try {
        const result = await qaVisualAgent(pageUrl, ctx.workspacePath, options);
        if (result.success && result.data) {
          reports.push(result.data as QaVisualReport);

          // Collect critical issues
          const qaReport = result.data as QaVisualReport;
          for (const issue of qaReport.issues ?? []) {
            if (issue.severity === "critical") {
              criticalIssues.push(`[${pagePath}] ${issue.description}`);
            } else if (issue.severity === "warning") {
              fixHints.push(`[${pagePath}] ${issue.description}`);
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`Visual review failed for ${pagePath}: ${msg}`);
        // Non-blocking — skip page if review fails
      }
    }

    // Aggregate scores
    const scores = reports.map((r) => r.overallScore ?? 0);
    const overallScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    const passed =
      reports.length > 0 && overallScore >= passScore && criticalIssues.length === 0;

    this.log(
      `Screenshot validation complete — score: ${overallScore}, passed: ${passed}, ` +
        `critical: ${criticalIssues.length}, warnings: ${fixHints.length}`,
    );

    const output: ScreenshotValidationOutput = {
      passed,
      overallScore,
      reports,
      criticalIssues,
      fixHints,
      durationMs: Date.now() - start,
    };

    return this.buildResult(passed, output, start, 0, passed ? undefined : "UI quality below threshold");
  }
}

export const screenshotValidationSkill = new ScreenshotValidationSkill();
