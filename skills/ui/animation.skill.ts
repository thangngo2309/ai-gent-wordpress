/**
 * Animation Skill.
 *
 * Motion and animation guidelines for premium WordPress themes.
 * All animations are wrapped in prefers-reduced-motion media queries.
 * Exports buildAnimationRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

export function buildAnimationRules(): string {
  return `
ANIMATION & MOTION SYSTEM (premium — tasteful, accessible):

CORE RULE: Every animation MUST be inside @media (prefers-reduced-motion: no-preference).
Never define transition: or animation: outside this media query.

APPROVED TRANSITIONS (on interactive elements):
@media (prefers-reduced-motion: no-preference) {
  /* Buttons */
  .btn { transition: background-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast); }
  .btn:hover { transform: translateY(-2px); }

  /* Cards */
  .product-card,
  .feature-card,
  .testimonial-card { transition: transform var(--transition-normal), box-shadow var(--transition-normal); }
  .product-card:hover,
  .feature-card:hover { transform: translateY(-4px); }

  /* Card images */
  .product-card__image img { transition: transform var(--transition-slow); }
  .product-card:hover .product-card__image img { transform: scale(1.04); }

  /* Nav links */
  .nav-link { transition: color var(--transition-fast); }

  /* Links */
  a { transition: color var(--transition-fast); }
}

ENTRANCE ANIMATIONS (page load — subtle, tasteful):
@media (prefers-reduced-motion: no-preference) {
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .hero__content { animation: fadeInUp 0.5s ease forwards; }
  .hero__visual   { animation: fadeInUp 0.6s ease 0.15s forwards; opacity: 0; }
}

FORBIDDEN ANIMATIONS:
- Never use: bounce, shake, flash, rubber-band, or other attention-seeking effects.
- Never use animation-duration above 0.8s for UI elements.
- Never animate font-size, width, or height (causes layout shifts).
- Never use animation on background-color of large sections (expensive).

SCROLL-TRIGGERED ANIMATIONS:
- Optional: use Intersection Observer in assets/js/animations.js to add class .is-visible.
- Elements start with opacity: 0; transform: translateY(20px).
- On .is-visible: opacity: 1; transform: none; transition: 0.5s ease.
- Always set transition inside @media (prefers-reduced-motion: no-preference).`.trim();
}

export interface AnimationOutput { rules: string }

export class AnimationSkill extends BaseSkill<void, AnimationOutput> {
  readonly name = "ui/animation";
  readonly description = "Motion and animation guidelines for premium WordPress themes";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<AnimationOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Animation rules built");
    return this.buildResult(true, { rules: buildAnimationRules() }, start);
  }
}

export const animationSkill = new AnimationSkill();
