/**
 * E-commerce UI Skill.
 *
 * Premium ecommerce-specific UI patterns for WordPress/WooCommerce themes.
 * Exports buildEcommerceUiRules() for use by premium-ui.skill.ts.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

export function buildEcommerceUiRules(): string {
  return `
ECOMMERCE UI SYSTEM (Shopify/premium quality required):

HOMEPAGE ECOMMERCE SECTIONS (in order):
1. Hero: strong headline + CTA + visual showing the product/brand.
2. Featured Categories: visual category tiles (minimum 3, with distinct gradients).
3. Featured Products: 3–4 product cards in a grid.
4. Value Propositions: 3-column icon grid (Free shipping / Secure payment / Returns policy).
5. Testimonials: 3 customer reviews with star ratings.
6. Brand/Trust bar: logos or badges in a horizontal scrollable strip.
7. Newsletter CTA: email capture form with strong headline and primary-color background.
8. Footer.

HEADER:
- Sticky header with: logo, primary nav, search icon, cart icon with item count badge.
- Cart badge: circular bubble on top-right of cart icon, background: var(--color-accent),
  font-size: 10px, min-width: 18px, border-radius: var(--radius-full).
- Search: expandable inline search bar OR modal overlay.
- Mobile: hamburger + cart icon only in header, full menu in mobile overlay.

PRODUCT LISTING PAGE (archive-product.php):
- Filter/sort bar above the grid: category filter tabs + sort dropdown.
- Product cards: grid with add-to-cart on hover overlay or visible button below image.
- "Quick view" button on card hover (optional but premium).
- Pagination or infinite scroll below the grid.

SINGLE PRODUCT PAGE (single-product.php):
- Two-column layout: large image gallery left, product info right.
- Sticky product info column on scroll.
- Breadcrumb navigation above product.
- Price: prominent, large (var(--text-3xl)), with sale price if applicable.
- Add to cart: full-width, primary color, large button with cart icon.
- Product description tabs: Description / Specifications / Reviews.

CART & CHECKOUT:
- Cart: clean list layout with quantity stepper, remove button, subtotal.
- Checkout: multi-step or single-page with clear section labels.
- Order summary sidebar on desktop.

VALUE PROPOSITION ICONS:
- Use simple inline SVGs (truck, shield, refresh, headphones) — NOT emoji or text alone.
- Icon size: 40px, var(--color-primary) fill or stroke.
- Text: bold label + short description.`.trim();
}

export interface EcommerceUiOutput { rules: string }

export class EcommerceUiSkill extends BaseSkill<void, EcommerceUiOutput> {
  readonly name = "ui/ecommerce";
  readonly description = "Premium ecommerce UI patterns for WordPress/WooCommerce themes";
  readonly version = "1.0.0";

  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<EcommerceUiOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Ecommerce UI rules built");
    return this.buildResult(true, { rules: buildEcommerceUiRules() }, start);
  }
}

export const ecommerceUiSkill = new EcommerceUiSkill();
