/**
 * Responsive QA Skill.
 *
 * Validates layout behavior across viewports:
 * 1440px (desktop), 1024px (tablet-landscape), 768px (tablet),
 * 480px (mobile-landscape), 390px (mobile).
 *
 * Since screenshots are captured at 1440px and 390px, the review
 * criteria focus on those two viewports but include guidance for
 * the intermediate sizes as static analysis hints.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildResponsiveQaBlock(): string {
  return `
━━ RESPONSIVE QUALITY REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate desktop (1440px) and mobile (390px) screenshots side by side.

DESKTOP 1440px — CHECK ALL:
□ No horizontal scrollbar or overflow past viewport width.
□ Hero section uses two columns (text left, visual right) — both columns visible.
□ Product/feature cards are in a 3- or 4-column grid with equal heights.
□ Navigation is fully visible in a single horizontal row.
□ Section containers are max-width constrained (not stretching to full 1440px edge).
□ Hero visual/illustration fills its column proportionally (not a tiny 400px image).
□ Footer uses a multi-column layout (not stacked unnecessarily on desktop).

MOBILE 390px — CHECK ALL:
□ No horizontal overflow or content cut off at the right edge.
□ Navigation collapses to hamburger or stacked links (not overflowing).
□ All card grids collapse to 1 column.
□ Hero switches to single-column stacked layout (text on top, visual below).
□ CTA buttons are full-width or clearly touchable (≥44px height).
□ All text is readable — minimum 14px, no truncated headings.
□ Images and SVGs respect the 390px container (no overflow, no scale issues).
□ Section padding reduces on mobile (not wasting screen space with desktop margins).
□ The footer stacks cleanly — contact info and links are accessible.

COMMON RESPONSIVE FAILURES (critical if present):
✗ Text/cards overflow horizontally at 390px causing a scrollbar.
✗ Navigation items still in a row at 390px, overlapping.
✗ Two-column grid NOT collapsing at mobile (cards squeezed unreadably thin).
✗ Hero image covers the headline text on mobile.
✗ Fixed-width elements (e.g. 600px SVG) causing overflow on mobile.
✗ Buttons too small to tap on mobile (< 44px height).

BREAKPOINT ANALYSIS (static code review):
□ CSS breakpoints at 768px and 480px are present in style.css.
□ min-width: 0 is set on grid/flex children to prevent overflow.
□ overflow: hidden is set on image wrapper containers.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface ResponsiveQaOutput {
  criteriaBlock: string;
}

export class ResponsiveQaSkill extends BaseSkill<void, ResponsiveQaOutput> {
  readonly name = "qa/responsive";
  readonly description = "Responsive QA: viewport checks for desktop, tablet, and mobile layouts";
  readonly version = "1.0.0";


  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<ResponsiveQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildResponsiveQaBlock();
    return {
      success: true,
      data: { criteriaBlock },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const responsiveQaSkill = new ResponsiveQaSkill();
