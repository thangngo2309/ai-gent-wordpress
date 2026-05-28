/**
 * Brand Style Skill.
 *
 * Enforces visual brand consistency across every section of a generated theme.
 * Defines rules for how design tokens propagate consistently through the theme —
 * same shadow scale, same radius system, same color application patterns.
 *
 * This skill acts as a "style constitution" — a single source of truth that
 * prevents the LLM from inventing ad-hoc values for each section.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  RULES
// ─────────────────────────────────────────────────────────────────────────────

export function buildBrandStyleRules(): string {
  return `
BRAND STYLE CONSISTENCY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHADOW SCALE (use ONLY these — never invent new values):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var(--shadow-sm)         → subtle hover lift on small elements
  var(--shadow-md)         → default card shadow
  var(--shadow-lg)         → modal, dropdown, sticky header shadow
  var(--shadow-xl)         → hero floating cards, featured items
  var(--shadow-card)       → product cards in resting state
  var(--shadow-card-hover) → product cards on :hover (transforms to)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BORDER RADIUS SCALE (use ONLY these):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var(--radius-sm)   → tag pills, small badges, input fields
  var(--radius-md)   → buttons, icon containers
  var(--radius-lg)   → cards, dropdowns
  var(--radius-xl)   → large cards, hero panels, image frames
  var(--radius-full) → circles, rounded pills (100vw)
  NEVER mix radius tokens — if cards use --radius-lg, ALL cards use --radius-lg.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COLOR APPLICATION (consistent across all sections):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Primary buttons:      background: var(--color-primary)  text: white
  Primary button hover: background: var(--color-primary-dark)
  Secondary buttons:    background: transparent  border: 2px solid var(--color-primary)  text: var(--color-primary)
  Ghost links:          color: var(--color-primary)  no background  underline on hover
  Danger actions:       background: var(--color-error)  text: white
  Success states:       color: var(--color-success)  or background: #dcfce7
  Active nav items:     color: var(--color-primary)  border-bottom or indicator dot
  Section backgrounds alternate: white → var(--color-bg-secondary) → white → dark

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TYPOGRAPHY CONSISTENCY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Page-level heading (h1):  font-size clamp(2.5rem, 5vw, 4rem);  font-weight 800; line-height 1.1
  Section heading (h2):     font-size clamp(1.75rem, 3vw, 2.5rem); font-weight 700; line-height 1.2
  Sub-section heading (h3): font-size 1.25rem–1.5rem;  font-weight 600; line-height 1.3
  Body copy:                font-size 1rem–1.125rem;   line-height 1.7; color var(--color-text-secondary)
  Small/caption:            font-size 0.875rem;         line-height 1.5; color var(--color-text-muted)
  ALL headings use the heading font (set per industry in fonts stack)
  ALL body text uses the body font (Inter or equivalent)
  NEVER use a third font family

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUTTON SYSTEM (every button on site follows this system):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 28px;
    border-radius: var(--radius-md);
    font-size: 1rem;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    border: 2px solid transparent;
    transition: all var(--transition-normal);
    white-space: nowrap;
    text-decoration: none;
  }
  .btn--primary   { background: var(--color-primary); color: white; }
  .btn--primary:hover { background: var(--color-primary-dark); transform: translateY(-1px); box-shadow: var(--shadow-md); }
  .btn--secondary { border-color: var(--color-primary); color: var(--color-primary); background: transparent; }
  .btn--secondary:hover { background: var(--color-primary); color: white; }
  .btn--white     { background: white; color: var(--color-primary); }
  .btn--white:hover { background: var(--color-primary-light); }
  .btn--lg { padding: 16px 36px; font-size: 1.125rem; }
  .btn--sm { padding: 8px 18px; font-size: 0.875rem; }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION ANATOMY (consistent for every section):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  <section class="section section--[modifier]">
    <div class="container">
      <div class="section-header">   ← centered text + eyebrow + h2 + lead
        <span class="eyebrow">...</span>
        <h2>...</h2>
        <p class="lead">...</p>
      </div>
      <div class="section-body">    ← the main content grid/layout
        ...
      </div>
    </div>
  </section>

  .section { padding: 5rem 1.5rem; }
  .section--dark { background: var(--color-primary-dark) or darkBg color; color: white; }
  .section--tinted { background: var(--color-bg-secondary); }
  .section--accent { background: var(--color-primary-light); }
  .section-header { max-width: 640px; margin: 0 auto 3rem; text-align: center; }
  .eyebrow { font-size: 0.875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-primary); margin-bottom: 0.5rem; display: block; }
  .lead { font-size: 1.125rem; color: var(--color-text-secondary); margin-top: 1rem; }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LINK HOVER STATES (brand-consistent across all links):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Body links: color: var(--color-primary); text-decoration: underline on hover
  Nav links: no underline; color: var(--color-text-primary) resting; color: var(--color-primary) hover
  Card links: text-decoration none; the whole card lifts on hover
  Footer links: color: muted; color: white on hover

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND CONSISTENCY VIOLATIONS (detect + fix these):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✗ Hardcoded hex colors (#0ea5e9) outside CSS vars — use var() instead
  ✗ Inconsistent radius (some cards 8px, others 16px on same level)
  ✗ Button padding inconsistency across sections
  ✗ Different h2 sizes on different sections of the same page
  ✗ Mixing bold/italic/uppercase on section eyebrows inconsistently
  ✗ Different font-families appearing on same page (3+ fonts)
  ✗ Section headers left-aligned on some sections, centered on others (pick one and stick)`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface BrandStyleOutput { rules: string }

export class BrandStyleSkill extends BaseSkill<undefined, BrandStyleOutput> {
  readonly name = "visual/brand-style";
  readonly description = "Brand consistency rules for shadows, radius, colors, typography, and buttons";
  readonly version = "1.0.0";

  async execute(
    _input: undefined,
    _ctx: GenerationContext,
  ): Promise<SkillResult<BrandStyleOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Brand style consistency rules loaded");
    return this.buildResult(true, { rules: buildBrandStyleRules() }, start);
  }
}

export const brandStyleSkill = new BrandStyleSkill();
