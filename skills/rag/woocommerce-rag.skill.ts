/**
 * WooCommerce RAG (Retrieval-Augmented Generation) Context Skill.
 *
 * Provides WooCommerce-specific knowledge context for LLM prompts.
 * Covers theme compatibility, hook reference, template overrides,
 * and security patterns specific to WooCommerce.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────────────────────────

const WOO_KNOWLEDGE: Record<string, string> = {
  "theme-compatibility": `
WooCommerce Theme Compatibility Requirements:

1. Declare support in functions.php:
   add_theme_support( 'woocommerce' );
   add_theme_support( 'wc-product-gallery-zoom' );
   add_theme_support( 'wc-product-gallery-lightbox' );
   add_theme_support( 'wc-product-gallery-slider' );

2. Include WooCommerce body class:
   <body <?php body_class(); ?>>

3. Always check if WooCommerce is active before using its functions:
   if ( class_exists( 'WooCommerce' ) ) { ... }
   // or use the helper:
   if ( function_exists( 'WC' ) ) { ... }

4. Cart fragment AJAX support (required for cart widget):
   add_filter( 'woocommerce_add_to_cart_fragments', '{prefix}_cart_fragment' );

5. Template override location (copy from woocommerce/templates/):
   {theme}/woocommerce/ — WooCommerce will use these instead of plugin defaults
`,

  "key-hooks": `
WooCommerce Key Hooks:

Content Hooks:
  woocommerce_before_main_content    — Wrap main content
  woocommerce_after_main_content     — Close main content wrapper
  woocommerce_sidebar                — Output sidebar (or skip for full width)

Product Loop:
  woocommerce_before_shop_loop       — Before product grid
  woocommerce_after_shop_loop        — After product grid
  woocommerce_before_shop_loop_item  — Before individual product card
  woocommerce_after_shop_loop_item   — After individual product card

Single Product:
  woocommerce_before_single_product  — Before product page
  woocommerce_after_single_product   — After product page
  woocommerce_single_product_summary — Product summary (title, price, add-to-cart)

Cart & Checkout:
  woocommerce_cart_is_empty          — When cart is empty
  woocommerce_before_checkout_form   — Before checkout form
  woocommerce_checkout_order_review  — Order summary on checkout
`,

  "security-patterns": `
WooCommerce Security Patterns:

1. Always verify nonces in AJAX handlers:
   check_ajax_referer( 'wc-action', 'security' );

2. Use WC data access methods — never raw DB queries on WC tables:
   $order  = wc_get_order( $order_id );   // not direct query
   $product = wc_get_product( $product_id );

3. Sanitize & validate custom checkout fields:
   $field = isset( $_POST['my_field'] ) ? sanitize_text_field( wp_unslash( $_POST['my_field'] ) ) : '';

4. Use WC session for transient cart data (not PHP sessions):
   WC()->session->set( 'key', $value );
   WC()->session->get( 'key' );

5. Escape all WooCommerce output:
   echo esc_html( $product->get_name() );
   echo wc_price( $product->get_price() );  // built-in escaping
`,

  "template-overrides": `
WooCommerce Template Override Best Practices:

1. Only override templates you need to customize — don't copy all templates.
2. Keep template files up to date with the WooCommerce version.
3. Add a comment at the top of overrides noting the WC version:
   * WooCommerce Template Override
   * @version X.X.X

Common templates to override:
  woocommerce/archive-product.php          — Shop page layout
  woocommerce/content-product.php          — Product card in loop
  woocommerce/single-product.php           — Single product page
  woocommerce/cart/cart.php                — Cart table
  woocommerce/checkout/form-checkout.php   — Checkout form
`,
};

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface WooCommerceRagInput {
  topics?: Array<"theme-compatibility" | "key-hooks" | "security-patterns" | "template-overrides">;
}

export interface WooCommerceRagResult {
  context: string;
  topicsResolved: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export class WooCommerceRagSkill extends BaseSkill<WooCommerceRagInput, WooCommerceRagResult> {
  readonly name = "rag/woocommerce";
  readonly description = "Provides WooCommerce knowledge context for LLM prompts";
  readonly version = "1.0.0";

  validators = [];

  async execute(
    input: WooCommerceRagInput,
    _ctx: GenerationContext,
  ): Promise<SkillResult<WooCommerceRagResult>> {
    const start = Date.now();

    const topics = input.topics ?? ["theme-compatibility", "key-hooks", "security-patterns"];
    const resolved: string[] = [];
    const parts: string[] = [];

    for (const topic of topics) {
      const kb = WOO_KNOWLEDGE[topic];
      if (kb) {
        parts.push(`## WooCommerce: ${topic}\n${kb}`);
        resolved.push(topic);
      }
    }

    return this.buildResult(
      true,
      { context: parts.join("\n\n"), topicsResolved: resolved },
      start,
    );
  }
}

export const wooCommerceRagSkill = new WooCommerceRagSkill();
