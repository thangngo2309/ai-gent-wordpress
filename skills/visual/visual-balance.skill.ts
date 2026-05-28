/**
 * Visual Balance Skill.
 *
 * Enforces proper content-to-visual ratios and section composition rules
 * to prevent the most common AI generation flaw: walls of text with no
 * visual anchors.
 *
 * A well-balanced page alternates visual weight between text and graphics,
 * never lets 3+ consecutive sections be text-heavy, and maintains visual
 * interest through deliberate use of backgrounds, patterns, and layout.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  RULES
// ─────────────────────────────────────────────────────────────────────────────

export function buildVisualBalanceRules(): string {
  return `
VISUAL BALANCE & SECTION COMPOSITION

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAGE-LEVEL VISUAL RHYTHM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED page structure for all generated themes:
  1. Hero       → image-heavy (visual right column, rich composition)
  2. Stats/Social proof  → visual (numbers + icons, or logo strip)
  3. Features   → visual (icon grid OR alternating image+text rows)
  4. How it Works / Process → visual (numbered steps with icons and connectors)
  5. Product/Service → visual (card grid with illustrated placeholders)
  6. Testimonials → visual (quote cards with avatars and star ratings)
  7. FAQ         → interactive (accordion — not a wall of text)
  8. CTA Banner  → visual (full-width gradient with decorative elements)
  9. Footer      → structured (columns, NOT a text dump)

CRITICAL BALANCE RULES:
  - NEVER place 3 text-only sections consecutively without a visual break.
  - Every section header must have: eyebrow label + H2 + optional lead paragraph.
  - Minimum one visual element per section beyond the header text.
  - At least 40% of page sections must have non-text primary content (cards, images, icons).
  - No section may be entirely composed of plain paragraph text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION-LEVEL VISUAL WEIGHT RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Text-left / Visual-right (standard feature row):
  - Content column: max 480px; headline + description + benefit list + CTA.
  - Visual column: min 400px; illustration, screenshot, or product visual.
  - Ratio: 45% text, 55% visual (the visual should feel slightly dominant).

Text-center / Cards-below (feature grid):
  - Header block: centered, max-width 640px, with eyebrow + H2 + lead.
  - Cards below: 3-4 columns, each with icon + title + 2-3 sentence description.
  - No card may have more than 4 lines of description text.
  - Each card MUST have an icon (SVG, 32×32, in a colored icon container).

Full-width visual (hero, CTA, testimonial):
  - The visual element must span at least 50% of the viewport width on desktop.
  - Dark sections get light text — ALWAYS check contrast ratios.
  - CTA banners use gradient backgrounds (never plain solid color).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION BACKGROUND ALTERNATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mandatory background pattern for a typical 9-section page:
  1. Hero       → dark gradient (primary-dark to black)
  2. Stats      → var(--color-bg-secondary)
  3. Features   → white (#ffffff)
  4. Process    → var(--color-primary-light) tint OR var(--color-bg-secondary)
  5. Products   → white
  6. Testimonials → var(--color-bg-secondary)
  7. FAQ        → white
  8. CTA Banner → dark gradient (primary to accent) OR pure dark
  9. Footer     → darkest (primary-dark or #0f172a)

Rules:
  - NEVER use the same background for more than 2 consecutive sections.
  - Dark sections (hero + CTA + footer): 3 is the maximum for a standard page.
  - Avoid stark white-only pages — at least 3 sections should use a tinted background.
  - Background changes REPLACE section dividers — no horizontal rules between sections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHITESPACE & BREATHING ROOM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Section padding:
  - Desktop: 5rem top/bottom (80px).
  - Tablet:  3.5rem top/bottom.
  - Mobile:  2.5rem top/bottom.
  NEVER: padding < 2rem top/bottom on any section.
  NEVER: padding > 8rem (creates disconnected, spacey feeling).

Content gaps:
  - Between section header and content grid: 3rem.
  - Between cards in a grid: 1.5rem–2rem.
  - Between text paragraphs: 1rem.
  - Between a heading and its following paragraph: 0.75rem.
  - CTA button margin-top from preceding paragraph: 1.5rem.

Heading-to-content ratio:
  - Section headings should NEVER take up more than 30% of section height.
  - If heading is large, reduce the lead text length.
  - Avoid 3-line section headlines on desktop — aim for 2 lines max.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GRID & COLUMN VISUAL BALANCE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Feature card grids:
  - 3 columns preferred on desktop for 6 features.
  - 4 columns for 8 features (smaller cards).
  - Each card same height via CSS: align-items: stretch in grid.
  - Odd number of cards (5, 7): last row centered — use justify-content: center.
  - ALL cards same visual weight (same icon size, same padding, same radius).

Two-column layouts:
  - Prefer 55:45 split (slightly dominant visual column) over 50:50.
  - Never 70:30 (too unbalanced for feature rows).
  - ALWAYS vertically center both columns (align-items: center).

Stats bar (social proof strip):
  - 3–5 stats in a row, separated by vertical dividers.
  - Number: large (2rem, bold, primary color).
  - Label: small (0.875rem, muted, uppercase).
  - Centered horizontally.
  - Background: slightly contrasting from adjacent sections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISUAL WEIGHT VIOLATIONS TO AVOID:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✗ Three consecutive plain text paragraphs with no visual break
  ✗ A 600px+ paragraph block in a feature card
  ✗ Two adjacent dark sections that merge visually
  ✗ Feature section with no icons — pure text bullet points
  ✗ Hero with text-only content on both columns
  ✗ Footer that is a single column of plain text
  ✗ Process/steps section with just numbered text (no icons, no connectors)
  ✗ CTA section with just a button and text (no background differentiation)
  ✗ Product grid with empty white boxes as image placeholders`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface VisualBalanceOutput { rules: string }

export class VisualBalanceSkill extends BaseSkill<undefined, VisualBalanceOutput> {
  readonly name = "visual/visual-balance";
  readonly description = "Section composition, content-to-visual ratios, and page-level visual rhythm rules";
  readonly version = "1.0.0";

  async execute(
    _input: undefined,
    _ctx: GenerationContext,
  ): Promise<SkillResult<VisualBalanceOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Visual balance rules loaded");
    return this.buildResult(true, { rules: buildVisualBalanceRules() }, start);
  }
}

export const visualBalanceSkill = new VisualBalanceSkill();
