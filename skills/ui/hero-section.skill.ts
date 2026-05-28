/**
 * Hero Section Skill.
 *
 * Premium hero section patterns and rules for WordPress theme generation.
 * Exports buildHeroRules() and a PHP/HTML template reference pattern.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildHeroRules(): string {
  return `
HERO SECTION (premium — above-the-fold impact required):

LAYOUT:
- Desktop: two-column grid — left column: text content, right column: visual/illustration.
- Mobile: single column stacked — text first, then visual below.
- Minimum height: min-height: 90vh on desktop, auto on mobile.
- Background: gradient using brand colors OR a subtle geometric pattern.
  Example: background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-primary-light) 100%)
- Never use plain white or plain grey for the hero background.

CONTENT STRUCTURE (in order, top to bottom):
1. Eyebrow label: small uppercase text with icon or badge, var(--color-primary) color.
2. H1 headline: 3rem+ (--text-5xl), font-weight: 800, tight line-height (1.05).
3. Subtitle: 1.125rem–1.25rem (--text-lg to --text-xl), var(--color-text-secondary), max-width: 540px.
4. CTA button group: primary filled button + optional secondary outline button, side by side.
5. Trust signal: small text with icons (e.g. star rating, number of customers, badge icons).

VISUAL (right column on desktop):
- Show a rich visual: inline SVG illustration, gradient card with stats, or layered cards.
- The visual must fill the right column and be visually interesting (not a plain rectangle).
- Use a decorative gradient blob/circle behind the visual for depth.
- Stats/numbers displayed inside the visual must be real-looking data, not "0" or blank.

CTA BUTTONS:
- Primary: background: var(--color-primary), color: white, border-radius: var(--radius-full),
  padding: 0.875rem 2rem, font-weight: 600, font-size: var(--text-base).
  On hover: background: var(--color-primary-dark), transform: translateY(-1px), var(--shadow-lg).
- Secondary: border: 2px solid var(--color-border-strong), background: transparent,
  color: var(--color-text-primary), same border-radius and padding.
- Mobile: buttons stack to full-width (width: 100%).

ANIMATION (motion-safe only):
@media (prefers-reduced-motion: no-preference) {
  .hero__content: animate-in with opacity 0→1 + translateY(16px→0), 0.5s ease.
  .hero__visual: animate-in with opacity 0→1 + scale(0.97→1), 0.6s ease 0.15s.
}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface HeroSectionOutput { rules: string }

export class HeroSectionSkill extends BaseSkill<void, HeroSectionOutput> {
  readonly name = "ui/hero-section";
  readonly description = "Premium hero section patterns for WordPress theme generation";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<HeroSectionOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Hero section rules built");
    return this.buildResult(true, { rules: buildHeroRules() }, start);
  }
}

export const heroSectionSkill = new HeroSectionSkill();
