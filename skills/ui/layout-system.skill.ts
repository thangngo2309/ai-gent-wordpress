/**
 * Layout System Skill
 *
 * Enforces proper grid layout, spacing, responsive breakpoints, and
 * equal-height card patterns across all generated WordPress themes.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  LAYOUT SYSTEM RULES BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildLayoutSystemRules(): string {
  return `
════════════════════════════════════════════════════════════════════════════════
LAYOUT SYSTEM — GRID, SPACING & RESPONSIVE RULES
════════════════════════════════════════════════════════════════════════════════

## A. CONTAINER SYSTEM (use in every section)

\`\`\`css
/* ── Container ── */
.container,
.site-shell,
[class*="__container"] {
  width: 100%;
  max-width: var(--container-max, 1280px);
  margin-inline: auto;
  padding-inline: var(--space-6, 24px);
}

@media (min-width: 768px) {
  .container,
  .site-shell,
  [class*="__container"] {
    padding-inline: var(--space-8, 32px);
  }
}

@media (min-width: 1280px) {
  .container,
  .site-shell,
  [class*="__container"] {
    padding-inline: var(--space-10, 40px);
  }
}
\`\`\`

## B. 12-COLUMN GRID (standard layout)

\`\`\`css
/* ── Base grid ── */
.grid {
  display: grid;
  gap: var(--space-6, 24px);
}

/* ── 2-column ── */
.grid--2 { grid-template-columns: 1fr; }
@media (min-width: 640px) {
  .grid--2 { grid-template-columns: repeat(2, 1fr); }
}

/* ── 3-column ── */
.grid--3 { grid-template-columns: 1fr; }
@media (min-width: 640px) {
  .grid--3 { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1024px) {
  .grid--3 { grid-template-columns: repeat(3, 1fr); }
}

/* ── 4-column ── */
.grid--4 { grid-template-columns: repeat(2, 1fr); }
@media (min-width: 1024px) {
  .grid--4 { grid-template-columns: repeat(4, 1fr); }
}

/* ── 2-column asymmetric (hero, about) ── */
.grid--hero { grid-template-columns: 1fr; }
@media (min-width: 768px) {
  .grid--hero { grid-template-columns: 1fr 1fr; gap: var(--space-12, 48px); }
}
@media (min-width: 1024px) {
  .grid--hero { grid-template-columns: 1.1fr 0.9fr; }
}
\`\`\`

## C. EQUAL-HEIGHT CARDS (mandatory for all card grids)

ALL card grids must use this pattern to prevent broken unequal heights:

\`\`\`css
/* ── Card grid wrapper ── */
[class*="__grid"],
[class*="__cards"],
.card-grid {
  display: grid;
  gap: var(--space-6, 24px);
}

/* ── Card must be flex column to push footer to bottom ── */
[class*="__card"],
.card,
.post-card,
.product-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface, #ffffff);
  border: 1px solid var(--color-border, rgba(0,0,0,0.08));
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}

@media (prefers-reduced-motion: no-preference) {
  [class*="__card"]:hover,
  .card:hover,
  .post-card:hover,
  .product-card:hover {
    box-shadow: 0 12px 32px rgba(0,0,0,0.10);
    transform: translateY(-3px);
  }
}

/* ── Card body grows to fill — pushes price/CTA to bottom ── */
[class*="__card-content"],
[class*="__card-body"],
.card__content,
.post-card__content,
.product-card__content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--space-5, 20px);
}

/* ── Card footer pinned to bottom ── */
[class*="__card-footer"],
.card__footer,
.post-card__footer,
.product-card__footer {
  margin-top: auto;
  padding: var(--space-4, 16px) var(--space-5, 20px) var(--space-5, 20px);
}
\`\`\`

## D. SECTION SPACING SYSTEM

\`\`\`css
/* ── Section vertical rhythm ── */
[class*="section-"],
.section {
  padding-block: var(--space-16, 64px);
}

@media (min-width: 1024px) {
  [class*="section-"],
  .section {
    padding-block: var(--space-24, 96px);
  }
}

/* ── Section header spacing ── */
[class*="__header"],
.section__header {
  max-width: 680px;
  margin-inline: auto;
  text-align: center;
  margin-bottom: var(--space-12, 48px);
}
\`\`\`

## E. RESPONSIVE BREAKPOINTS (mobile-first, mandatory)

Use ONLY these breakpoints — never use arbitrary pixel values:

| Breakpoint | Variable   | Value    | Use case                    |
|------------|------------|----------|-----------------------------|
| Mobile     | —          | default  | Single column, stacked      |
| Sm         | —          | 480px    | 2-col cards, wider padding  |
| Md         | —          | 768px    | 2-col hero, nav change      |
| Lg         | —          | 1024px   | 3+ col grids, sidebar       |
| Xl         | —          | 1280px   | Max container width         |

\`\`\`css
/* Mobile: 0-479px — single column, all stacked */
/* Sm: 480px — 2-col small cards */
@media (min-width: 480px) { /* ... */ }

/* Md: 768px — hero 2-col, nav transitions */
@media (min-width: 768px) { /* ... */ }

/* Lg: 1024px — 3+ column grids, sidebar layouts */
@media (min-width: 1024px) { /* ... */ }

/* Xl: 1280px — max container, large type */
@media (min-width: 1280px) { /* ... */ }
\`\`\`

## F. OVERFLOW PREVENTION (critical for mobile)

\`\`\`css
/* Global overflow guard */
html, body {
  overflow-x: hidden;
}

img, video, svg, canvas, iframe {
  max-width: 100%;
  height: auto;
}

/* Prevent text overflow in cards */
[class*="__card"] {
  min-width: 0;
  word-break: break-word;
}
\`\`\`

## G. LAYOUT ANTI-PATTERNS (NEVER do these)

- NEVER use \`position: absolute\` width/height for grid items
- NEVER hard-code \`height: 200px\` on a card — use \`min-height\` or \`aspect-ratio\` on image containers only
- NEVER set \`overflow: hidden\` on the body or main — it prevents sticky headers from working
- NEVER use \`float\` for layout — use flex or grid
- NEVER stack multiple media query breakpoints in a single \`@media\` block if they have different logic
- NEVER use negative margins that exceed the container padding
- NEVER use a fixed pixel font-size on \`html\` or \`body\` — use \`100%\` or \`clamp()\`
`;
}
