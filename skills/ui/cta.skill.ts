/**
 * CTA Skill.
 *
 * Premium Call-to-Action section patterns for WordPress themes.
 * Exports buildCtaRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

export function buildCtaRules(): string {
  return `
CTA SECTION (call-to-action — conversion-focused):

LAYOUT OPTIONS:
A) Full-width banner (default): dark/gradient background, centered text + button.
B) Split: left text + right form/button side-by-side.
C) Card: centered card with shadow, floating over a colored section.

FULL-WIDTH BANNER PATTERN:
  <section class="cta-section">
    <div class="container">
      <div class="cta-section__inner">
        <div class="cta-section__content">
          <h2 class="cta-section__title">Compelling Headline</h2>
          <p class="cta-section__subtitle">Supporting copy that reinforces the value.</p>
        </div>
        <div class="cta-section__actions">
          <a class="btn btn--white btn--lg" href="#">Primary CTA</a>
          <a class="btn btn--outline-white btn--lg" href="#">Secondary CTA</a>
        </div>
      </div>
    </div>
  </section>

STYLING:
- .cta-section: background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
  padding: var(--space-section) 0.
- .cta-section__inner: display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-8); flex-wrap: wrap.
- .cta-section__title: font-size: var(--text-4xl); font-weight: 800; color: #ffffff;
  font-family: var(--font-heading); margin-bottom: var(--space-4).
- .cta-section__subtitle: font-size: var(--text-lg); color: rgba(255,255,255,0.85);
  max-width: 500px; line-height: 1.6.

BUTTON VARIANTS FOR CTA:
- .btn--white: background: #ffffff; color: var(--color-primary); border: none;
  border-radius: var(--radius-full); padding: 0.875rem 2.25rem; font-weight: 700;
  font-size: var(--text-base); box-shadow: var(--shadow-md).
  On hover: box-shadow: var(--shadow-xl); transform: translateY(-2px).
- .btn--outline-white: background: transparent; border: 2px solid rgba(255,255,255,0.6);
  color: #ffffff; border-radius: var(--radius-full); padding: 0.875rem 2.25rem; font-weight: 600.
  On hover: background: rgba(255,255,255,0.1); border-color: #ffffff.

PLACEMENT:
- Include at least one CTA section per page, usually near the bottom above the FAQ or footer.
- Never use a plain grey or white background for the primary CTA — it must stand out visually.
- The primary CTA button must have strong contrast and visual weight.`.trim();
}

export interface CtaOutput { rules: string }

export class CtaSkill extends BaseSkill<void, CtaOutput> {
  readonly name = "ui/cta";
  readonly description = "Premium CTA section patterns for WordPress themes";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<CtaOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("CTA rules built");
    return this.buildResult(true, { rules: buildCtaRules() }, start);
  }
}

export const ctaSkill = new CtaSkill();
