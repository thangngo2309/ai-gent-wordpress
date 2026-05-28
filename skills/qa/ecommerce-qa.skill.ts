/**
 * E-commerce QA Skill.
 *
 * Reviews e-commerce-specific quality: product cards, pricing display,
 * cart/checkout CTAs, product image quality, and conversion elements.
 * Only applied when the project is WooCommerce / e-commerce.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildEcommerceQaBlock(): string {
  return `
━━ E-COMMERCE QA REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate e-commerce quality as a CRO (Conversion Rate Optimization) specialist.

PRODUCT CARD QUALITY:
□ Product card image areas are rich and clearly show what the product looks like.
□ Product name is visible and readable at card size.
□ Price is prominently displayed (larger than product description text).
□ "Add to Cart" or "Buy Now" CTA button is visible on every product card.
□ Product card hover state shows the CTA or highlights the card.
□ Cards in the product grid have consistent height and padding.

PRODUCT CATALOG LAYOUT:
□ Products are displayed in a grid (3–4 columns desktop, 2 columns tablet, 1 mobile).
□ Product filtering/sorting controls are present or implied (tags, categories).
□ Featured/highlighted products are visually distinguished.

PRICING DISPLAY:
□ Price formatting is clear (currency symbol, number formatting).
□ Sale/discount prices show the original price struck through.
□ Promotional badges (SALE, NEW, FEATURED) are visually prominent.

CHECKOUT/CONVERSION FLOW:
□ Clear path from product to purchase (Product → Cart → Checkout).
□ Cart icon in navigation shows item count (or is prominently placed).
□ "Buy Now" / "Shop Now" CTA in hero leads to product catalog.

TRUST ELEMENTS (E-commerce specific):
□ Product specifications or key features are visible on the product card or nearby.
□ Reviews/ratings are displayed where applicable.
□ Shipping/warranty/guarantee information is present.

E-COMMERCE FAILURE PATTERNS:
✗ Product prices are absent or hidden.
✗ "Add to Cart" button is not visible without hovering.
✗ Product image area looks like a grey placeholder box.
✗ No path from hero CTA to actual products.
✗ Product cards have inconsistent sizes in the same grid.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface EcommerceQaInput {
  isEcommerce?: boolean;
}

export interface EcommerceQaOutput {
  criteriaBlock: string;
  skipped: boolean;
}

export class EcommerceQaSkill extends BaseSkill<EcommerceQaInput, EcommerceQaOutput> {
  readonly name = "qa/ecommerce";
  readonly description = "E-commerce QA: product cards, pricing, cart CTA, conversion flow";
  readonly version = "1.0.0";


  async execute(input: EcommerceQaInput, _ctx: GenerationContext): Promise<SkillResult<EcommerceQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const isEcommerce = input?.isEcommerce ?? true; // Default to include
    const criteriaBlock = isEcommerce ? buildEcommerceQaBlock() : "";
    return {
      success: true,
      data: { criteriaBlock, skipped: !isEcommerce },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const ecommerceQaSkill = new EcommerceQaSkill();
