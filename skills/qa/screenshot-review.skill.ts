/**
 * Screenshot Review Skill.
 *
 * Builds the complete Vision API review prompt combining all QA dimension
 * checklists into a single structured prompt for Claude's multimodal API.
 *
 * This is the prompt-builder that `qa-master.skill.ts` uses to construct
 * the final review prompt sent to the LLM with screenshots attached.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { buildVisualQaBlock } from "./visual-qa.skill.js";
import { buildResponsiveQaBlock } from "./responsive-qa.skill.js";
import { buildImageQaBlock } from "./image-qa.skill.js";
import { buildLayoutQaBlock } from "./layout-qa.skill.js";
import { buildTypographyQaBlock } from "./typography-qa.skill.js";
import { buildSpacingQaBlock } from "./spacing-qa.skill.js";
import { buildCompositionQaBlock } from "./composition-qa.skill.js";
import { buildUxQaBlock } from "./ux-qa.skill.js";
import { buildAccessibilityQaBlock } from "./accessibility-qa.skill.js";
import { buildUiScoreBlock } from "./ui-score.skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export interface ScreenshotReviewOptions {
  /** Brand/project context injected into the review */
  brandContext?: string;
  /** Number of screenshots attached (default: 2) */
  screenshotCount?: number;
  /** Whether to include e-commerce specific criteria */
  includeEcommerce?: boolean;
  /** Preview HTTP status (e.g. "200 OK") */
  previewStatus?: string;
  /** Clipped preview HTML body */
  previewHtml?: string;
  /** Server output/errors for context */
  serverOutput?: string;
}

export function buildScreenshotReviewPrompt(opts: ScreenshotReviewOptions = {}): string {
  const brand = opts.brandContext ?? "WordPress theme — no brand context provided";
  const count = opts.screenshotCount ?? 2;
  const status = opts.previewStatus ?? "200";
  const html = opts.previewHtml ?? "(not provided)";
  const serverOut = opts.serverOutput ?? "(not provided)";

  return `[VISUAL_SCORE]
You are a strict, detail-obsessed senior UI/UX quality reviewer.
Your job is to find EVERY flaw and score the page honestly.

IMPORTANT: Analyze ALL ${count} screenshot(s) — desktop (1440px) first, then mobile (390px).
Be a strict critic. Reserve scores above 85 for pages that genuinely impress a paying client.

━━ BRAND CONTEXT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${brand}

━━ REVIEW CRITERIA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate EACH section below. Note PASS / WARNING / FAIL and specific issues.

${buildImageQaBlock()}

${buildVisualQaBlock()}

${buildLayoutQaBlock()}

${buildTypographyQaBlock()}

${buildResponsiveQaBlock()}

${buildSpacingQaBlock()}

${buildCompositionQaBlock()}

${buildUxQaBlock()}

${buildAccessibilityQaBlock()}

${buildUiScoreBlock()}

━━ SUPPORTING CONTEXT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREVIEW STATUS: ${status}

PREVIEW HTML (first 8000 chars):
${html}

SERVER OUTPUT:
${serverOut}

━━ RESPONSE FORMAT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Respond ONLY with this JSON (no markdown fences, no extra keys):
{
  "score": 0,
  "desktopScore": 0,
  "mobileScore": 0,
  "severity": "pass",
  "dimensionScores": {
    "visual": 0,
    "layout": 0,
    "typography": 0,
    "images": 0,
    "responsive": 0,
    "ux": 0,
    "spacing": 0,
    "a11y": 0
  },
  "issues": [
    "Specific issue description including which section it affects"
  ],
  "autoFixHints": [
    "Specific fix suggestion"
  ],
  "explanation": "Two-paragraph summary: paragraph 1 covers strengths, paragraph 2 covers the most critical issues to fix."
}

RULES:
- score = weighted average of dimension scores (visual 20%, layout 15%, typography 15%, images 15%, responsive 15%, ux 10%, spacing 5%, a11y 5%)
- severity "pass" requires score >= 75 AND no dimension below 40
- severity "polish" for score 60–74 OR any dimension 40–64
- severity "fail" for score < 60 OR any dimension below 40
- List at least 3 issues even for "pass" pages
- autoFixHints must be actionable CSS/HTML changes, not vague suggestions
Preview URL: ${status}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface ScreenshotReviewOutput {
  prompt: string;
}

export class ScreenshotReviewSkill extends BaseSkill<ScreenshotReviewOptions, ScreenshotReviewOutput> {
  readonly name = "qa/screenshot-review";
  readonly description = "Builds the full Vision API review prompt combining all QA dimension criteria";
  readonly version = "1.0.0";


  async execute(
    input: ScreenshotReviewOptions,
    _ctx: GenerationContext,
  ): Promise<SkillResult<ScreenshotReviewOutput>> {
    const start = Date.now();
    this.logs = [];
    const prompt = buildScreenshotReviewPrompt(input);
    return {
      success: true,
      data: { prompt },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const screenshotReviewSkill = new ScreenshotReviewSkill();
