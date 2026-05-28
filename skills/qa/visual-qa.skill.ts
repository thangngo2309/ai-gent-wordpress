/**
 * Visual QA Skill.
 *
 * Provides a detailed visual quality review checklist for generated
 * WordPress themes. Evaluates color harmony, brand consistency,
 * visual hierarchy, and overall aesthetic quality.
 *
 * Acts as a prompt-builder (buildVisualQaBlock) for the QA master prompt,
 * and as a standalone BaseSkill for pipeline integration.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildVisualQaBlock(): string {
  return `
━━ VISUAL QUALITY REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate overall visual quality like a senior UI designer reviewing a premium
theme for a paying client. Be strict — mediocre is not acceptable.

COLOR HARMONY:
□ Primary brand color is prominently visible across hero, CTAs, and highlights.
□ Color palette is cohesive (2–3 brand colors max, plus neutrals).
□ Accent colors create intentional contrast — not random highlights.
□ Background sections alternate meaningfully (white → subtle tint → white).
□ No flat grey/white "corporate default" look with no brand color presence.
□ No neon or clashing color combinations that hurt readability.

VISUAL HIERARCHY:
□ The page has a clear focal point above the fold (hero headline + CTA).
□ Section headings are visually dominant over body text (≥2× larger).
□ CTA buttons stand out from surrounding content (filled, high contrast).
□ Important content (price, headline, badge) draws the eye first.
□ Decorative elements do not compete with key content.

BRAND CONSISTENCY:
□ The same color tokens are used consistently throughout (no random off-brand colors).
□ Typography is consistent — heading font is the same across all sections.
□ Card styles are consistent within each section.
□ Icon style is consistent (all outline, all filled, or all brand-colored).

SECTION DISTINCTIVENESS:
□ Each section is visually distinct from adjacent sections.
□ Alternating background colors or separator patterns prevent sections blurring.
□ Section transitions feel intentional, not accidental.

PREMIUM POLISH INDICATORS:
□ The page does NOT look AI-generated or template-cloned.
□ It would not embarrass a professional web agency if shown to a client.
□ At least one "wow" element (animated counter, illustrated hero, rich card).
□ Overall impression: polished, modern, industry-appropriate.

ANTI-PATTERNS (any of these significantly lower the score):
✗ Entire page looks grey/white with no brand color presence.
✗ Every section uses identical card layout with identical colors.
✗ SVG illustrations use the same color as their container background.
✗ Hero section feels empty or has poor visual weight on the right column.
✗ The page could belong to any industry — no visual identity.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface VisualQaOutput {
  criteriaBlock: string;
}

export class VisualQaSkill extends BaseSkill<void, VisualQaOutput> {
  readonly name = "qa/visual";
  readonly description = "Visual quality review criteria: color harmony, hierarchy, brand consistency";
  readonly version = "1.0.0";


  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<VisualQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildVisualQaBlock();
    return {
      success: true,
      data: { criteriaBlock },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const visualQaSkill = new VisualQaSkill();
