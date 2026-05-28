/**
 * Spacing Skill.
 *
 * Provides premium spacing and whitespace rules for WordPress theme generation.
 * Exports buildSpacingRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildSpacingRules(): string {
  return `
SPACING SYSTEM (generous whitespace = premium quality):

SECTION SPACING:
- Vertical padding per section: var(--space-section) (5rem) on mobile,
  var(--space-section-lg) (7.5rem) on desktop (min-width: 1024px).
- Never use padding-top/bottom below 3rem for full-width sections.
- Add 1.5rem gap between eyebrow label and section title.
- Add 1rem gap between section title and subtitle/body copy.
- Add 3rem gap between section intro copy and the section content (grid/cards).

COMPONENT SPACING:
- Card internal padding: 1.5rem to 2rem (never less than 1.25rem).
- Card grid gap: 1.5rem (mobile), 2rem (desktop).
- Button padding: 0.75rem 1.75rem (default), 0.875rem 2.25rem (large).
- Input/form field padding: 0.75rem 1rem.
- Nav item padding: 0.5rem 1rem.
- Header height: min 64px; use padding: 1rem 0 with sticky positioning.

CONTAINER WIDTHS:
- Default section container: max-width: var(--container-xl) (1280px), margin: 0 auto.
- Content (blog/article): max-width: var(--container-content) (720px).
- Always add horizontal padding: padding-inline: var(--space-4) (1rem) on mobile,
  padding-inline: var(--space-8) (2rem) on tablet,
  padding-inline: var(--space-12) (3rem) on desktop.

GRID GAPS:
- Feature/product card grid: gap: 1.5rem mobile, gap: 2rem desktop.
- Two-column split layout: gap: 4rem desktop, gap: 2rem mobile.
- Icon + text rows: gap: 0.75rem.

WHITESPACE RULES:
- Never collapse sections — always have breathing room between them.
- Use margin-bottom: var(--space-8) below major headings.
- Never stack two <section> elements with zero space between them.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface SpacingOutput { rules: string }

export class SpacingSkill extends BaseSkill<void, SpacingOutput> {
  readonly name = "ui/spacing";
  readonly description = "Premium spacing and whitespace rules for WordPress theme generation";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<SpacingOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Spacing rules built");
    return this.buildResult(true, { rules: buildSpacingRules() }, start);
  }
}

export const spacingSkill = new SpacingSkill();
