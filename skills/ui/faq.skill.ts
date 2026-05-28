/**
 * FAQ Skill.
 *
 * Premium FAQ accordion section patterns for WordPress themes.
 * Exports buildFaqRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

export function buildFaqRules(): string {
  return `
FAQ SECTION (accordion — elegant and accessible):

LAYOUT:
- Single column, max-width: var(--container-content) (720px), centered.
- Each FAQ item is an <details>/<summary> pair OR a JS-powered accordion div.

PREFERRED MARKUP (native HTML — no JS required):
  <details class="faq-item">
    <summary class="faq-item__question">Question text?</summary>
    <div class="faq-item__answer"><p>Answer text.</p></div>
  </details>

STYLING:
- .faq-item: border: 1px solid var(--color-border); border-radius: var(--radius-lg);
  overflow: hidden; margin-bottom: var(--space-3).
- .faq-item__question: font-size: var(--text-lg); font-weight: 600;
  color: var(--color-text-primary); padding: var(--space-5) var(--space-6);
  cursor: pointer; list-style: none; display: flex; align-items: center;
  justify-content: space-between; background: var(--color-bg-primary).
- Arrow indicator: rotate 180deg when open using [open] > .faq-item__question::after selector.
  content: '▼'; font-size: var(--text-sm); color: var(--color-primary);
  transition: transform var(--transition-fast).
- [open] .faq-item__question: background: var(--color-bg-secondary); color: var(--color-primary).
- .faq-item__answer: padding: var(--space-4) var(--space-6) var(--space-6);
  color: var(--color-text-secondary); line-height: 1.75; font-size: var(--text-base).
- On hover (.faq-item__question): background: var(--color-bg-secondary).

CONTENT:
- Include 6–8 real, relevant FAQ items for the project domain.
- Questions must be specific to the actual website topic (not generic "How do I sign up?").
- Answers must be 2–4 sentences, informative, and genuine.

SECTION CONTEXT:
- Place FAQ near the bottom of the homepage, above the footer.
- Section background: alternating (white or var(--color-bg-secondary)).`.trim();
}

export interface FaqOutput { rules: string }

export class FaqSkill extends BaseSkill<void, FaqOutput> {
  readonly name = "ui/faq";
  readonly description = "Premium FAQ accordion section patterns for WordPress themes";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<FaqOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("FAQ rules built");
    return this.buildResult(true, { rules: buildFaqRules() }, start);
  }
}

export const faqSkill = new FaqSkill();
