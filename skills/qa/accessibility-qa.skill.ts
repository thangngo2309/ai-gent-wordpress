/**
 * Accessibility QA Skill.
 *
 * Reviews WCAG 2.1 AA compliance basics: color contrast, alt text,
 * focus indicators, keyboard navigation, and semantic HTML structure.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildAccessibilityQaBlock(): string {
  return `
━━ ACCESSIBILITY REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate basic WCAG 2.1 AA compliance as an accessibility auditor.

COLOR CONTRAST:
□ Body text on white background achieves ≥4.5:1 contrast ratio.
□ White text on primary brand color achieves ≥4.5:1 contrast ratio.
□ White text on hero gradient achieves ≥3:1 contrast ratio (large text exception).
□ Button text on button background achieves ≥4.5:1 contrast.
□ Placeholder text in inputs achieves ≥3:1 contrast.

SEMANTIC HTML:
□ Page uses <main id="main-content"> as the primary content landmark.
□ Navigation uses <nav aria-label="..."> or <nav aria-label="Main">.
□ Header uses <header role="banner">.
□ Footer uses <footer role="contentinfo">.
□ Heading hierarchy is logical: H1 → H2 → H3 (no skipped levels).
□ Buttons use <button> (not <div> or <a> styled as buttons).

IMAGES & MEDIA:
□ Every <img> has a meaningful alt="" attribute (not empty for informational images).
□ Decorative SVGs have aria-hidden="true".
□ Informational SVGs have appropriate aria-label or title.
□ No image conveys information that is not available in text.

KEYBOARD & FOCUS:
□ Interactive elements (buttons, links, inputs) are keyboard-reachable.
□ Focus styles are visible — not removed with outline: none without replacement.
□ Focus order follows the visual reading order.
□ Skip-to-content link is present (or at minimum, main landmark is reachable).

MOTION & ANIMATION:
□ Animations respect prefers-reduced-motion media query.
□ Auto-playing animations do not distract or cause accessibility issues.

ACCESSIBILITY NOTES (these affect the "Accessibility" score dimension):
□ Score above 80 requires: semantic landmarks, alt text on all images, visible focus, AA contrast.
□ Score above 60 requires: semantic landmarks, no purely decorative missing alt, basic heading structure.
□ Score below 40 means: fundamental accessibility failures (no landmarks, no focus styles, no alt text).
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface AccessibilityQaOutput {
  criteriaBlock: string;
}

export class AccessibilityQaSkill extends BaseSkill<void, AccessibilityQaOutput> {
  readonly name = "qa/accessibility";
  readonly description = "Accessibility QA: WCAG 2.1 AA contrast, semantic HTML, keyboard nav, alt text";
  readonly version = "1.0.0";


  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<AccessibilityQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildAccessibilityQaBlock();
    return {
      success: true,
      data: { criteriaBlock },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const accessibilityQaSkill = new AccessibilityQaSkill();
