/**
 * Responsive UI Skill.
 *
 * Mobile-first responsive layout rules for premium WordPress themes.
 * Exports buildResponsiveRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildResponsiveRules(): string {
  return `
RESPONSIVE LAYOUT SYSTEM (mobile-first — enforce at every breakpoint):

BREAKPOINT STRATEGY:
- Mobile:  default styles (no breakpoint) — design for 390px width first.
- Tablet:  @media (min-width: 768px)
- Desktop: @media (min-width: 1024px)
- Wide:    @media (min-width: 1280px)
- Never use max-width breakpoints (desktop-first) — always min-width.

MOBILE RULES:
- Single-column layout for all card grids on mobile.
- Hero: stack text above image/visual; full-width CTA button.
- Navigation: collapse to hamburger toggle; menu slides in or drops down.
- Section padding: var(--space-section) (5rem) vertically.
- Container: padding-inline: var(--space-4) (1rem).
- No horizontal overflow — test every section at 390px.
- Font sizes: H1 → var(--text-4xl) on mobile (vs --text-5xl on desktop).

TABLET RULES (min-width: 768px):
- Two-column grid for features/benefits.
- Hero: can show side-by-side layout.
- Card grids: 2 columns with gap: 1.5rem.
- Container: padding-inline: var(--space-8) (2rem).

DESKTOP RULES (min-width: 1024px):
- Three-column card grids for features.
- Four-column grid for product showcase (if applicable).
- Hero: full side-by-side with large typography.
- Section padding: var(--space-section-lg) (7.5rem) vertically.
- Container: padding-inline: var(--space-12) (3rem).

GRID PATTERNS:
- Feature cards:  grid-template-columns: 1fr → repeat(2,1fr) → repeat(3,1fr)
- Product cards:  grid-template-columns: 1fr → repeat(2,1fr) → repeat(4,1fr)
- Two-column split: grid-template-columns: 1fr → 1fr 1fr (at 768px)
- Always use CSS Grid (display: grid) or Flexbox (display: flex; flex-wrap: wrap).
- Never use float-based layouts.

IMAGE RESPONSIVENESS:
- All images: max-width: 100%; height: auto; display: block.
- Hero images: use aspect-ratio or fixed height with object-fit: cover.
- Card images: fixed aspect-ratio (e.g. aspect-ratio: 16/9 or 4/3), object-fit: cover.

NAVIGATION RESPONSIVE:
- Desktop: horizontal flex nav.
- Mobile: hidden by default (display: none), shown via JS toggle class (.menu-open).
- Menu toggle button: visible only on mobile (hide at min-width: 1024px).
- Ensure the menu toggle class is identical in HTML, CSS, and JS.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface ResponsiveUiOutput { rules: string }

export class ResponsiveUiSkill extends BaseSkill<void, ResponsiveUiOutput> {
  readonly name = "ui/responsive";
  readonly description = "Mobile-first responsive layout rules for premium WordPress themes";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<ResponsiveUiOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Responsive rules built");
    return this.buildResult(true, { rules: buildResponsiveRules() }, start);
  }
}

export const responsiveUiSkill = new ResponsiveUiSkill();
