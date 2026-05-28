/**
 * UI Score Skill.
 *
 * Defines the 8-dimension scoring system with weights, thresholds,
 * scoring benchmarks, and auto-fix recommendation logic.
 *
 * The score dimensions are:
 *   1. Visual Quality     (20%)
 *   2. Layout & Structure (15%)
 *   3. Typography         (15%)
 *   4. Image Quality      (15%)
 *   5. Responsive Quality (15%)
 *   6. UX Quality         (10%)
 *   7. Spacing & Rhythm   ( 5%)
 *   8. Accessibility      ( 5%)
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  SCORING DIMENSIONS
// ─────────────────────────────────────────────────────────────────────────────

export const UI_SCORE_DIMENSIONS = [
  { id: "visual",      label: "Visual Quality",     weight: 0.20 },
  { id: "layout",      label: "Layout & Structure",  weight: 0.15 },
  { id: "typography",  label: "Typography",          weight: 0.15 },
  { id: "images",      label: "Image Quality",       weight: 0.15 },
  { id: "responsive",  label: "Responsive Quality",  weight: 0.15 },
  { id: "ux",          label: "UX Quality",          weight: 0.10 },
  { id: "spacing",     label: "Spacing & Rhythm",    weight: 0.05 },
  { id: "a11y",        label: "Accessibility",       weight: 0.05 },
] as const;

export type ScoreDimensionId = (typeof UI_SCORE_DIMENSIONS)[number]["id"];

export interface DimensionScore {
  id: ScoreDimensionId;
  label: string;
  score: number;     // 0–100
  weight: number;    // 0–1
  contribution: number; // score × weight
}

// ─────────────────────────────────────────────────────────────────────────────
//  THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

export const UI_SCORE_THRESHOLDS = {
  /** Minimum overall score to pass without polish pass */
  pass: 75,
  /** Minimum overall score to pass after polish pass */
  passAfterPolish: 70,
  /** Score below this triggers auto-fix + re-generation */
  autoFixThreshold: 60,
  /** Per-dimension minimum — any dimension below this is a critical failure */
  dimensionCritical: 40,
  /** Per-dimension warning — any dimension below this generates a warning */
  dimensionWarning: 65,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
//  SCORING GUIDANCE BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildUiScoreBlock(): string {
  return `
━━ SCORING SYSTEM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Score each of the 8 dimensions (0–100) and calculate a weighted overall score.

DIMENSIONS AND WEIGHTS:
  1. Visual Quality     (20%) — color harmony, brand consistency, aesthetic appeal
  2. Layout & Structure (15%) — grid alignment, overflow, container sizing
  3. Typography         (15%) — heading scale, weight contrast, readability
  4. Image Quality      (15%) — richness of image areas, SVG quality, no placeholders
  5. Responsive Quality (15%) — mobile/desktop layout correctness
  6. UX Quality         (10%) — CTA visibility, navigation clarity, conversion signals
  7. Spacing & Rhythm   ( 5%) — section padding, card gap, vertical rhythm
  8. Accessibility      ( 5%) — contrast, alt text, semantic structure

SCORE BENCHMARKS:
  95–100 : Exceptional — magazine/agency quality, client-ready immediately
  85–94  : Good — polished, professional, minor tweaks only
  75–84  : Acceptable — functional and presentable but room for improvement
  60–74  : Mediocre — noticeable visual or UX issues that hurt professionalism
  40–59  : Poor — multiple significant problems affecting usability
  0–39   : Broken — fundamental failures (empty content, broken layout, placeholder images)

SEVERITY RULES:
  "pass"   : overallScore ≥ 75 AND no dimension below 40
  "polish" : overallScore 60–74 OR any dimension score 40–64
  "fail"   : overallScore < 60 OR any dimension score below 40

AUTO-FIX TRIGGER:
  Image Quality < 50 → regenerate card image areas with contrasting SVG illustration colors
  Layout & Structure < 50 → fix grid overflow and container max-width
  Typography < 50 → increase heading font-size scale and load premium web font
  Responsive Quality < 50 → fix mobile grid collapse and overflow
  Visual Quality < 50 → improve color usage and section backgrounds

CRITICAL DIMENSION FAILURES (any of these = "fail" severity):
  • Image Quality < 40: card image areas look like placeholders
  • Layout & Structure < 40: page has visible overflow or broken grids
  • Responsive Quality < 40: mobile layout is broken or unusable
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  WEIGHTED SCORE CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

export function calculateWeightedScore(
  dimensionScores: Record<string, number>,
): { overall: number; dimensions: DimensionScore[] } {
  const dimensions: DimensionScore[] = UI_SCORE_DIMENSIONS.map((dim) => {
    const score = Math.max(0, Math.min(100, Number(dimensionScores[dim.id] ?? 0)));
    return {
      id: dim.id,
      label: dim.label,
      score,
      weight: dim.weight,
      contribution: score * dim.weight,
    };
  });

  const overall = Math.round(dimensions.reduce((sum, d) => sum + d.contribution, 0));
  return { overall, dimensions };
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO-FIX RECOMMENDATIONS
// ─────────────────────────────────────────────────────────────────────────────

export function getAutoFixRecommendations(dimensions: DimensionScore[]): string[] {
  const fixes: string[] = [];
  for (const dim of dimensions) {
    if (dim.score >= UI_SCORE_THRESHOLDS.dimensionWarning) continue;
    switch (dim.id) {
      case "images":
        fixes.push(
          "Image Quality is low: regenerate card image areas with white/light SVG shapes on gradient backgrounds. Ensure hero visual uses max-width: 560px. Resize icon card areas to max 120px height.",
        );
        break;
      case "layout":
        fixes.push(
          "Layout issues: add min-width: 0 on grid/flex children. Check for overflow-x issues. Ensure container max-width is set.",
        );
        break;
      case "typography":
        fixes.push(
          "Typography hierarchy weak: increase H1 to 3rem+ and H2 to 2.25rem+. Load Plus Jakarta Sans from Google Fonts. Body text should be 16px minimum.",
        );
        break;
      case "responsive":
        fixes.push(
          "Responsive issues: add @media (max-width: 768px) grid-template-columns: 1fr. Check mobile for horizontal overflow.",
        );
        break;
      case "visual":
        fixes.push(
          "Visual quality low: strengthen primary brand color usage in section backgrounds. Add visual differentiation between sections.",
        );
        break;
      case "ux":
        fixes.push(
          "UX issues: add high-contrast CTA button in hero section. Ensure navigation is clearly readable.",
        );
        break;
      case "spacing":
        fixes.push(
          "Spacing issues: increase section padding to 80px+ desktop. Use consistent 24–32px card gap.",
        );
        break;
      case "a11y":
        fixes.push(
          "Accessibility: add descriptive alt text to all images. Ensure focus styles are visible. Check color contrast ratios.",
        );
        break;
    }
  }
  return fixes;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface UiScoreInput {
  dimensionScores?: Record<string, number>;
}

export interface UiScoreOutput {
  criteriaBlock: string;
  dimensionScores?: DimensionScore[];
  overallScore?: number;
  autoFixRecommendations?: string[];
}

export class UiScoreSkill extends BaseSkill<UiScoreInput, UiScoreOutput> {
  readonly name = "qa/ui-score";
  readonly description = "UI scoring system: 8-dimension weighted score, thresholds, auto-fix triggers";
  readonly version = "1.0.0";


  async execute(input: UiScoreInput, _ctx: GenerationContext): Promise<SkillResult<UiScoreOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildUiScoreBlock();

    let dimensionScores: DimensionScore[] | undefined;
    let overallScore: number | undefined;
    let autoFixRecommendations: string[] | undefined;

    if (input?.dimensionScores) {
      const result = calculateWeightedScore(input.dimensionScores);
      dimensionScores = result.dimensions;
      overallScore = result.overall;
      autoFixRecommendations = getAutoFixRecommendations(result.dimensions);
    }

    return {
      success: true,
      data: { criteriaBlock, dimensionScores, overallScore, autoFixRecommendations },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const uiScoreSkill = new UiScoreSkill();
