/**
 * Typography QA Skill.
 *
 * Reviews typographic quality: heading scale, weight contrast,
 * readability, line-height, and font rendering.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildTypographyQaBlock(): string {
  return `
━━ TYPOGRAPHY REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate typographic quality as a professional type designer reviewing a premium theme.

HEADING HIERARCHY:
□ H1 (hero) is visually dominant — noticeably larger than H2 section headings.
□ H1 is at minimum 2.5× the size of body text (e.g., 48px H1 vs 16px body).
□ H2 section headings are clearly larger than H3 card headings.
□ H3 card headings are larger than body text (e.g., 24px H3 vs 16px body).
□ Font weight increases with heading level: H1 (800), H2 (700), H3 (700), body (400).

FONT QUALITY:
□ A premium heading font is used (Plus Jakarta Sans, Inter, Nunito, Outfit — NOT system-ui only).
□ Body text uses a highly readable font (Inter, Lato, Source Sans) at 400–500 weight.
□ The heading and body fonts pair well together (not two similar fonts that look the same).
□ Web fonts are loaded (Google Fonts or system stack with fallback).

READABILITY:
□ Body text is minimum 16px (1rem) on desktop.
□ Body text line-height is 1.6–1.8 for comfortable reading.
□ Body text color is #374151 (dark grey) or similar — NOT pure black #000000.
□ Text on colored backgrounds (hero, CTA sections) has adequate contrast (≥4.5:1).
□ No text block is wider than 70 characters (max-width: 680px on text columns).

TYPOGRAPHIC DETAILS:
□ Eyebrow/label text (small uppercase category labels) uses letter-spacing: 0.08em+.
□ Section subtitles/descriptions are noticeably smaller and lighter than headings.
□ Buttons use 500–600 font-weight (not regular weight text on buttons).
□ Navigation links are 15–16px, not too large or too small.

TYPOGRAPHY FAILURE PATTERNS:
✗ H1 is barely larger than H2 — no clear size hierarchy.
✗ All text uses the same generic system font (no premium font pair).
✗ Body text is 14px or smaller on desktop.
✗ Text on dark/colored backgrounds is low contrast (< 4.5:1).
✗ Long paragraphs run full viewport width (no max-width constraint).
✗ Heading font-weight is 400 (no visual weight for headings).
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface TypographyQaOutput {
  criteriaBlock: string;
}

export class TypographyQaSkill extends BaseSkill<void, TypographyQaOutput> {
  readonly name = "qa/typography";
  readonly description = "Typography QA: heading scale, weight contrast, readability, font quality";
  readonly version = "1.0.0";


  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<TypographyQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildTypographyQaBlock();
    return {
      success: true,
      data: { criteriaBlock },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const typographyQaSkill = new TypographyQaSkill();
