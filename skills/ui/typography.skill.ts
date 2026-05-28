/**
 * Typography Skill.
 *
 * Provides premium typography rules injected into the WordPress theme
 * generation prompt. Exports buildTypographyRules() for use by
 * premium-ui.skill.ts and as a standalone BaseSkill.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildTypographyRules(): string {
  return `
TYPOGRAPHY SYSTEM (premium quality — enforce strictly):

FONT LOADING:
- Load "Plus Jakarta Sans" (700, 800) + "Inter" (400, 500, 600) from Google Fonts
  via wp_enqueue_style() in functions.php with a preconnect hint.
- --font-heading: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif
- --font-body:    'Inter', system-ui, sans-serif

SIZE SCALE (use CSS custom properties — never bare px/rem literals for text):
- Hero H1:        var(--text-5xl)  → 3rem,    line-height: 1.05, font-weight: 800
- Section H2:     var(--text-4xl)  → 2.25rem, line-height: 1.15, font-weight: 700
- Card H3:        var(--text-2xl)  → 1.5rem,  line-height: 1.25, font-weight: 700
- H4:             var(--text-xl)   → 1.25rem, font-weight: 600
- Body:           var(--text-base) → 1rem,    line-height: 1.75, font-weight: 400
- Muted/caption:  var(--text-sm)   → 0.875rem
- Eyebrow label:  var(--text-sm), font-weight: 600, letter-spacing: 0.08em, text-transform: uppercase

HIERARCHY RULES:
- H1 must be at least 2.5× larger than body text — visually dominant.
- Eyebrow text (small uppercase labels above section titles) must use var(--color-primary).
- Section titles must be 700+ weight with var(--color-text-primary).
- Body copy must be var(--color-text-secondary) for supporting text, never full black.
- Never set font-size below var(--text-xs) for any visible element.

FONT FAMILIES:
- Apply font-family: var(--font-heading) to h1, h2, h3, h4, h5, h6.
- Apply font-family: var(--font-body) to body, p, li, input, textarea, button.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface TypographyOutput { rules: string }

export class TypographySkill extends BaseSkill<void, TypographyOutput> {
  readonly name = "ui/typography";
  readonly description = "Premium typography rules for WordPress theme generation";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<TypographyOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Typography rules built");
    return this.buildResult(true, { rules: buildTypographyRules() }, start);
  }
}

export const typographySkill = new TypographySkill();
