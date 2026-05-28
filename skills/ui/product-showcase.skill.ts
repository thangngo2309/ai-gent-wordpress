/**
 * Product Showcase Skill.
 *
 * Premium product card and showcase patterns for WordPress/WooCommerce themes.
 * Exports buildProductShowcaseRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildProductShowcaseRules(): string {
  return `
PRODUCT SHOWCASE & CARDS (ecommerce-grade quality):

PRODUCT CARD STRUCTURE:
  <article class="product-card">
    <div class="product-card__image">...</div>
    <div class="product-card__body">
      <span class="product-card__category">Category</span>
      <h3 class="product-card__title">Product Name</h3>
      <p class="product-card__excerpt">Short description.</p>
      <div class="product-card__footer">
        <span class="product-card__price">$99</span>
        <a class="btn btn--primary btn--sm" href="#">Add to Cart</a>
      </div>
    </div>
  </article>

CARD VISUAL (image area):
- .product-card__image: aspect-ratio: 4/3; overflow: hidden; border-radius: var(--radius-lg) var(--radius-lg) 0 0.
- Image inside: width: 100%; height: 100%; object-fit: cover.
  On hover (motion-safe): transform: scale(1.04); transition: var(--transition-slow).
- When no image is available: display a rich gradient background with an SVG icon in the center.
  gradient: linear-gradient(135deg, var(--color-primary-light), var(--color-primary)); NOT a plain grey box.

CARD STYLING:
- Background: var(--color-bg-primary); border: 1px solid var(--color-border);
  border-radius: var(--radius-xl); overflow: hidden;
  box-shadow: var(--shadow-card); transition: transform var(--transition-normal), box-shadow var(--transition-normal).
- On hover: transform: translateY(-4px); box-shadow: var(--shadow-card-hover).
- Category badge: var(--text-xs), var(--color-primary), background: var(--color-primary-light),
  border-radius: var(--radius-full), padding: 0.25rem 0.75rem.
- Title: var(--text-xl), font-weight: 700, color: var(--color-text-primary).
- Price: var(--text-2xl), font-weight: 700, color: var(--color-primary).
- Sale price: original struck through in --color-text-muted, sale price in --color-error.

GRID LAYOUT:
- Mobile: 1 column.
- Tablet (768px+): 2 columns.
- Desktop (1024px+): 3–4 columns.
- Gap: 1.5rem (mobile), 2rem (desktop).
- Use CSS Grid: display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)).

CATEGORY GRID:
- Categories shown as visual tiles with gradient backgrounds.
- Each tile: min-height: 160px, border-radius: var(--radius-xl), overflow: hidden.
- Background: unique gradient per category (use distinct hues, not the same gradient).
- Category name: white, bold, centered, with a subtle dark overlay (rgba 0,0,0,0.2).

ADD TO CART BUTTON:
- Filled, primary color, rounded-full, with a cart icon if SVG is available.
- On hover: slight scale + shadow increase.
- Focus: visible outline with var(--color-primary) at 2px offset.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductShowcaseOutput { rules: string }

export class ProductShowcaseSkill extends BaseSkill<void, ProductShowcaseOutput> {
  readonly name = "ui/product-showcase";
  readonly description = "Premium product card and showcase patterns for WordPress/WooCommerce themes";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<ProductShowcaseOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Product showcase rules built");
    return this.buildResult(true, { rules: buildProductShowcaseRules() }, start);
  }
}

export const productShowcaseSkill = new ProductShowcaseSkill();
