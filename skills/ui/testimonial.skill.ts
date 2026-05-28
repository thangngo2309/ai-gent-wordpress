/**
 * Testimonial Skill.
 *
 * Premium testimonial section patterns for WordPress themes.
 * Exports buildTestimonialRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

export function buildTestimonialRules(): string {
  return `
TESTIMONIAL SECTION (social proof — high trust signal):

LAYOUT OPTIONS (choose one based on design context):
A) Card Grid: 3-column grid of quote cards (default).
B) Carousel: single large featured quote with avatar, scrollable (use Swiper or pure CSS scroll).
C) Masonry: staggered column layout for visual interest.

TESTIMONIAL CARD:
  <article class="testimonial-card">
    <div class="testimonial-card__quote">
      <svg class="testimonial-card__icon">...</svg>  <!-- large opening quote SVG -->
      <p class="testimonial-card__text">"Quote text here."</p>
    </div>
    <footer class="testimonial-card__author">
      <div class="testimonial-card__avatar">...</div>
      <div>
        <strong class="testimonial-card__name">Name</strong>
        <span class="testimonial-card__role">Role, Company</span>
      </div>
    </footer>
    <div class="testimonial-card__stars">★★★★★</div>
  </article>

CARD STYLING:
- Background: var(--color-bg-primary); border: 1px solid var(--color-border);
  border-radius: var(--radius-xl); padding: var(--space-8);
  box-shadow: var(--shadow-card).
- Quote icon: large (40px), var(--color-primary-light) color, decorative only.
- Quote text: var(--text-lg), color: var(--color-text-primary), line-height: 1.7,
  font-style: italic.
- Author name: var(--text-base), font-weight: 700, color: var(--color-text-primary).
- Role: var(--text-sm), color: var(--color-text-muted).
- Avatar: 48×48px circle (border-radius: var(--radius-full)), object-fit: cover.
  Fallback: gradient background with initials in white.
- Stars: var(--color-accent) (#f59e0b) color, font-size: var(--text-lg).

SECTION BACKGROUND:
- Use var(--color-bg-secondary) or a subtle gradient to differentiate from adjacent sections.

DATA (use real-sounding names and roles, not "John Doe" or "User"):
- Vietnamese names if project is Vietnamese; otherwise use culturally appropriate names.
- Role should be specific (e.g. "CEO, Tech Startup" not just "Customer").`.trim();
}

export interface TestimonialOutput { rules: string }

export class TestimonialSkill extends BaseSkill<void, TestimonialOutput> {
  readonly name = "ui/testimonial";
  readonly description = "Premium testimonial section patterns for WordPress themes";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<TestimonialOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Testimonial rules built");
    return this.buildResult(true, { rules: buildTestimonialRules() }, start);
  }
}

export const testimonialSkill = new TestimonialSkill();
