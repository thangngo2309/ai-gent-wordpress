/**
 * QA Master Skill — Central Aggregator.
 *
 * Combines all QA sub-skill criteria into a single comprehensive review prompt
 * for the visual quality gate in agent.ts.
 *
 * Key export: buildQaMasterPrompt() — used by scoreVisualQuality() in agent.ts
 * to replace the simple inline prompt with a deep, dimension-aware QA review.
 *
 * The prompt keeps the SAME response JSON shape that scoreVisualQuality() parses,
 * so no changes to the orchestration flow are needed.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { buildScreenshotReviewPrompt, type ScreenshotReviewOptions } from "./screenshot-review.skill.js";
import {
  calculateWeightedScore,
  getAutoFixRecommendations,
  UI_SCORE_THRESHOLDS,
  type DimensionScore,
} from "./ui-score.skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  MASTER PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export interface QaMasterPromptOptions {
  /** Preview HTTP status code/text (e.g. "200") */
  previewStatus: string;
  /** Clipped HTML body from the preview server */
  previewHtml: string;
  /** Server stdout/stderr from the PHP preview server */
  serverOutput: string;
  /** Brand name + project idea context */
  brandContext?: string;
  /** Number of screenshots being sent to Vision API (default: 2) */
  screenshotCount?: number;
  /** Include e-commerce specific QA criteria */
  includeEcommerce?: boolean;
}

/**
 * Build the comprehensive QA review prompt.
 *
 * This is the main entry point called from agent.ts scoreVisualQuality().
 * Returns a prompt string that instructs Claude to evaluate the page across
 * all 8 quality dimensions and return the same JSON schema already parsed
 * by scoreVisualQuality().
 */
export function buildQaMasterPrompt(opts: QaMasterPromptOptions): string {
  const reviewOpts: ScreenshotReviewOptions = {
    brandContext: opts.brandContext,
    screenshotCount: opts.screenshotCount ?? 2,
    includeEcommerce: opts.includeEcommerce ?? false,
    previewStatus: opts.previewStatus,
    previewHtml: opts.previewHtml,
    serverOutput: opts.serverOutput,
  };

  return buildScreenshotReviewPrompt(reviewOpts);
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESULT PARSER
// ─────────────────────────────────────────────────────────────────────────────

export interface QaMasterRawResult {
  score?: unknown;
  desktopScore?: unknown;
  mobileScore?: unknown;
  severity?: unknown;
  dimensionScores?: Record<string, unknown>;
  issues?: unknown;
  autoFixHints?: unknown;
  explanation?: unknown;
}

export interface QaMasterResult {
  /** Weighted overall score 0–100 */
  score: number;
  desktopScore: number;
  mobileScore: number;
  /** "pass" | "polish" | "fail" */
  severity: "pass" | "polish" | "fail";
  /** Per-dimension scores */
  dimensionScores: DimensionScore[];
  /** Short issue strings for the report */
  issues: string[];
  /** CSS/HTML fix hints for auto-polish pass */
  autoFixHints: string[];
  /** Computed auto-fix recommendations from ui-score skill */
  autoFixRecommendations: string[];
  explanation: string;
}

/**
 * Parse and normalize the LLM response from the QA master prompt.
 * Falls back gracefully if optional fields are missing.
 */
export function parseQaMasterResult(raw: QaMasterRawResult): QaMasterResult {
  const rawDimensions = raw.dimensionScores ?? {};
  const dimensionInput: Record<string, number> = {};
  for (const [key, val] of Object.entries(rawDimensions)) {
    dimensionInput[key] = Number(val ?? 0);
  }

  const { overall, dimensions } = calculateWeightedScore(dimensionInput);

  // Use LLM-provided score if dimensions are missing, otherwise use weighted calc
  const hasDimensions = Object.keys(dimensionInput).length >= 4;
  const score = hasDimensions ? overall : Number(raw.score ?? 0);
  const desktopScore = Number(raw.desktopScore ?? raw.score ?? 0);
  const mobileScore = Number(raw.mobileScore ?? raw.score ?? 0);

  const rawSeverity = String(raw.severity ?? "pass");
  let severity: "pass" | "polish" | "fail" = "pass";
  if (rawSeverity === "fail") severity = "fail";
  else if (rawSeverity === "polish") severity = "polish";

  // Override severity based on thresholds if dimensions are available
  if (hasDimensions) {
    const minDimension = Math.min(...dimensions.map((d) => d.score));
    if (score < UI_SCORE_THRESHOLDS.autoFixThreshold || minDimension < UI_SCORE_THRESHOLDS.dimensionCritical) {
      severity = "fail";
    } else if (score < UI_SCORE_THRESHOLDS.pass || minDimension < UI_SCORE_THRESHOLDS.dimensionWarning) {
      severity = "polish";
    }
  }

  const issues = Array.isArray(raw.issues) ? raw.issues.map((i) => String(i)) : [];
  const autoFixHints = Array.isArray(raw.autoFixHints) ? raw.autoFixHints.map((h) => String(h)) : [];
  const autoFixRecommendations = getAutoFixRecommendations(dimensions);
  const explanation = typeof raw.explanation === "string" ? raw.explanation : "QA review complete";

  return {
    score,
    desktopScore,
    mobileScore,
    severity,
    dimensionScores: dimensions,
    issues,
    autoFixHints,
    autoFixRecommendations,
    explanation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface QaMasterInput {
  previewStatus: string;
  previewHtml: string;
  serverOutput: string;
  brandContext?: string;
  screenshotCount?: number;
  includeEcommerce?: boolean;
}

export interface QaMasterOutput {
  prompt: string;
}

export class QaMasterSkill extends BaseSkill<QaMasterInput, QaMasterOutput> {
  readonly name = "qa/master";
  readonly description = "QA master aggregator: combines all 10 QA dimension criteria into one review prompt";
  readonly version = "1.0.0";


  async execute(
    input: QaMasterInput,
    _ctx: GenerationContext,
  ): Promise<SkillResult<QaMasterOutput>> {
    const start = Date.now();
    this.logs = [];
    const prompt = buildQaMasterPrompt(input);
    return {
      success: true,
      data: { prompt },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const qaMasterSkill = new QaMasterSkill();
