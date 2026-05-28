/**
 * Section Layout Skill.
 *
 * Reusable section layout patterns for premium WordPress themes:
 * features, benefits, stats, testimonials, FAQ, and CTA sections.
 * Exports buildSectionLayoutRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildSectionLayoutRules(): string {
  return `
SECTION LAYOUT SYSTEM (every section must follow this structure):

GENERAL SECTION ANATOMY:
  <section class="[name]-section">
    <div class="container">
      <div class="section-header">
        <span class="section-eyebrow">Eyebrow Label</span>
        <h2 class="section-title">Section Title</h2>
        <p class="section-subtitle">Supporting subtitle copy.</p>
      </div>
      <div class="[name]-grid"> ... cards or content ... </div>
    </div>
  </section>

CONTAINER CLASS:
- .container: max-width: var(--container-xl); margin: 0 auto;
  padding-inline: var(--space-4); (→ var(--space-12) at 1024px)

SECTION HEADER:
- .section-eyebrow: display: block; font-size: var(--text-sm); font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-primary);
  margin-bottom: var(--space-3).
- .section-title: font-size: var(--text-4xl); font-weight: 700;
  color: var(--color-text-primary); margin-bottom: var(--space-4);
  font-family: var(--font-heading).
- .section-subtitle: font-size: var(--text-lg); color: var(--color-text-secondary);
  max-width: 600px; margin-inline: auto; line-height: 1.7.
- Center-align section header text by default. Left-align only in split layouts.

ALTERNATING SECTION BACKGROUNDS:
- Sections must alternate: white → var(--color-bg-secondary) → white…
- Never stack two white-background sections; use var(--color-bg-secondary) for contrast.

FEATURE CARDS (icon + title + description):
- .feature-card: background: var(--color-bg-primary); border: 1px solid var(--color-border);
  border-radius: var(--radius-xl); padding: var(--space-8);
  box-shadow: var(--shadow-card); transition: transform var(--transition-normal),
  box-shadow var(--transition-normal).
- On hover (motion-safe): transform: translateY(-4px); box-shadow: var(--shadow-card-hover).
- Icon container: 48×48px circle, background: var(--color-primary-light),
  border-radius: var(--radius-full), centered icon in var(--color-primary).
- Card title: var(--text-xl), font-weight: 700, margin-bottom: var(--space-2).
- Card description: var(--text-base), var(--color-text-secondary), line-height: 1.7.

STATS / SOCIAL PROOF BAR:
- Background: var(--color-primary) or dark gradient.
- Horizontal flex row, wrap on mobile.
- Each stat: large bold number (var(--text-4xl), white), label below in white/80% opacity.
- Separator: subtle vertical border between stats on desktop.

DARK / ACCENT SECTIONS (for variety):
- Use a dark section (background: var(--color-text-primary) or deep gradient) once per page.
- Text inside: white for headings, rgba(255,255,255,0.8) for body.
- CTA buttons inside dark sections: white background, primary-color text.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionLayoutOutput { rules: string }

export class SectionLayoutSkill extends BaseSkill<void, SectionLayoutOutput> {
  readonly name = "ui/section-layout";
  readonly description = "Reusable section layout patterns for premium WordPress themes";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<SectionLayoutOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Section layout rules built");
    return this.buildResult(true, { rules: buildSectionLayoutRules() }, start);
  }
}

export const sectionLayoutSkill = new SectionLayoutSkill();
