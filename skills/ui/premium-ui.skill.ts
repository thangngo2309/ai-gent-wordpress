/**
 * Premium UI Skill — Central Aggregator.
 *
 * Combines all UI sub-skill rules into a single prompt injection block.
 * This block is injected into buildThemeBatchPrompt() to enforce
 * premium-quality UI generation for every WordPress theme.
 *
 * Usage in generation prompt:
 *   const uiBlock = buildPremiumUiBlock(ctx);
 *   // inject into theme batch prompt
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { buildTypographyRules } from "./typography.skill.js";
import { buildSpacingRules } from "./spacing.skill.js";
import { buildResponsiveRules } from "./responsive-ui.skill.js";
import { buildHeroRules } from "./hero-section.skill.js";
import { buildSectionLayoutRules } from "./section-layout.skill.js";
import { buildProductShowcaseRules } from "./product-showcase.skill.js";
import { buildTestimonialRules } from "./testimonial.skill.js";
import { buildFaqRules } from "./faq.skill.js";
import { buildCtaRules } from "./cta.skill.js";
import { buildAnimationRules } from "./animation.skill.js";
import { buildEcommerceUiRules } from "./ecommerce-ui.skill.js";
// Visual system
import { buildColorHarmonyRules } from "../../skills/visual/color-harmony.skill.js";
import { buildImageStrategyRules } from "../../skills/visual/image-selection.skill.js";
import { buildIllustrationRules } from "../../skills/visual/illustration.skill.js";
import { buildIconSystemRules } from "../../skills/visual/icon-system.skill.js";
import { buildBrandStyleRules } from "../../skills/visual/brand-style.skill.js";
import { buildHeroVisualRules } from "../../skills/visual/hero-visual.skill.js";
import { buildGalleryLayoutRules } from "../../skills/visual/gallery-layout.skill.js";
import { buildVisualBalanceRules } from "../../skills/visual/visual-balance.skill.js";
// Phase 3: image rendering + layout system
import { buildImageRenderingRules } from "./image-rendering.skill.js";
import { buildLayoutSystemRules } from "./layout-system.skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  VISUAL SYSTEM AGGREGATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the complete visual system block:
 * color harmony + image strategy + illustration patterns + icon system
 * + brand style + hero visual + gallery layouts + visual balance.
 */
function buildVisualSystemBlock(ctx: GenerationContext): string {
  const idea = ctx.idea ?? "";
  const divider = "─".repeat(56);

  return [
    divider,
    " VISUAL SYSTEM — COLOR · IMAGERY · COMPOSITION",
    divider,
    "",
    buildColorHarmonyRules(idea),
    "",
    divider,
    buildHeroVisualRules(idea),
    "",
    divider,
    buildImageStrategyRules(idea),
    "",
    divider,
    buildIllustrationRules(idea),
    "",
    divider,
    buildIconSystemRules(),
    "",
    divider,
    buildBrandStyleRules(),
    "",
    divider,
    buildGalleryLayoutRules(),
    "",
    divider,
    buildVisualBalanceRules(),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBAL UI ANTI-PATTERNS (injected into every theme prompt)
// ─────────────────────────────────────────────────────────────────────────────

const GLOBAL_UI_ANTI_PATTERNS = `
FORBIDDEN UI PATTERNS — NEVER GENERATE:
- Old Bootstrap-style layouts (no .col-md-4, no .row.clearfix, no float-based grids).
- Cramped spacing (no padding below 1rem inside cards, no sections shorter than 5rem vertically).
- Inconsistent typography (do not mix sizes randomly; always follow the type scale).
- Ugly gradients (no rainbow gradients, no neon colors, no gradients with >2 stops unless intentional).
- Generic grey placeholder boxes for images — always use a gradient + icon fallback.
- Plain white CTA buttons on white backgrounds (zero contrast — invisible).
- Buttons with no padding, no border-radius, and no color — "naked" links used as buttons.
- Outdated drop-shadow filter: drop-shadow(2px 2px 4px black) — use box-shadow instead.
- Inline style attributes for layout or spacing — use CSS classes.
- Tables for layout purposes.
- Fixed pixel widths that break on mobile.
- <br> tags for spacing — use CSS margin/padding.
- Empty sections with only a heading and no content.`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  VISUAL REFERENCE STANDARDS
// ─────────────────────────────────────────────────────────────────────────────

const VISUAL_REFERENCES = `
QUALITY STANDARD — Target the visual quality of:
- stripe.com    : ultra-clean layout, perfect spacing, subtle gradients, strong CTA.
- linear.app    : minimal, crisp typography, ample whitespace, dark/light sections.
- vercel.com    : bold hero, clean cards, high contrast, confident use of black.
- shopify.com   : polished ecommerce, warm colors, friendly typography, clear CTAs.
- apple.com     : editorial typography, giant imagery, minimal UI chrome.

These references define the BAR. Generated themes must look premium enough to
compete commercially — not like a free WordPress theme from 2015.`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export interface PremiumUiOptions {
  /** Include ecommerce-specific rules (default: auto-detect from idea) */
  includeEcommerce?: boolean;
  /** Include only essential sections to reduce prompt length */
  compact?: boolean;
}

/**
 * Build the complete premium UI prompt injection block.
 * Inject this into buildThemeBatchPrompt for every theme generation.
 */
export function buildPremiumUiBlock(
  ctx: GenerationContext,
  options: PremiumUiOptions = {},
): string {
  const idea = ctx.idea?.toLowerCase() ?? "";
  const isEcommerce =
    options.includeEcommerce ??
    /shop|store|ecommerce|e-commerce|woocommerce|product|cart|checkout|sell/i.test(idea);

  const divider = "━".repeat(56);

  const sections: string[] = [
    `${divider}`,
    ` UI QUALITY SYSTEM — PREMIUM MODERN DESIGN REQUIRED`,
    `${divider}`,
    "",
    VISUAL_REFERENCES,
    "",
    GLOBAL_UI_ANTI_PATTERNS,
    "",
    // ── Visual System (color harmony + illustration + icons + balance) ──
    buildVisualSystemBlock(ctx),
    "",
    // ── Image rendering + Layout system ──
    buildImageRenderingRules(),
    "",
    buildLayoutSystemRules(),
    "",
    // ── UI Layout & Component Rules ──
    buildTypographyRules(),
    "",
    buildSpacingRules(),
    "",
    buildHeroRules(),
    "",
    buildSectionLayoutRules(),
    "",
    buildCtaRules(),
    "",
    buildTestimonialRules(),
    "",
    buildFaqRules(),
    "",
    buildAnimationRules(),
    "",
    buildResponsiveRules(),
  ];

  if (isEcommerce) {
    sections.push("", buildEcommerceUiRules());
  }

  sections.push(
    "",
    `${divider}`,
    " UI + VISUAL SELF-CHECK — before returning JSON verify:",
    `${divider}`,
    "□ Hero section has gradient/colored background (NOT plain white).",
    "□ Hero visual column has multi-layer SVG composition (NOT empty box).",
    "□ Industry color palette applied: :root CSS vars use industry-specific colors.",
    "□ Section backgrounds alternate (white ↔ var(--color-bg-secondary) ↔ dark).",
    "□ All card image placeholders use gradient + SVG icon (NOT grey boxes).",
    "□ Every icon is inline SVG with viewBox='0 0 24 24', stroke-width='2', fill='none'.",
    "□ Every transition/animation is inside @media (prefers-reduced-motion: no-preference).",
    "□ No bare hex colors outside :root — only CSS custom properties.",
    "□ Mobile: all sections single-column, no overflow at 390px.",
    "□ Typography hierarchy: H1 > H2 > H3 > body, each clearly distinct in size.",
    "□ Primary CTA button is filled with var(--color-primary), high contrast.",
    "□ Google Fonts are enqueued via wp_enqueue_style() with preconnect hints.",
    "□ No 3+ consecutive text-only sections (visual break required).",
    "□ Product/service cards have colored image frames (not empty white).",
    "□ Brand consistency: same radius, same shadow scale, same font stack throughout.",
    "□ Every image container has aspect-ratio CSS (not fixed height) + overflow:hidden.",
    "□ Every img inside a card/product container has object-fit:cover + width:100% + height:100%.",
    "□ WordPress thumbnail templates use has_post_thumbnail() guard before the_post_thumbnail().",
    "□ WooCommerce product cards use $product->get_image() or woocommerce_template_loop_product_thumbnail().",
    "□ No plain gradient placeholder divs — all fallback images are inline SVG illustrations.",
    "□ Hero visual uses layered SVG composition with .hero__visual-bg + .hero__visual-svg + optional .hero__badge.",
    `${divider}`,
  );

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface PremiumUiOutput {
  uiBlock: string;
  includesEcommerce: boolean;
}

export class PremiumUiSkill extends BaseSkill<PremiumUiOptions, PremiumUiOutput> {
  readonly name = "ui/premium";
  readonly description = "Premium UI rules aggregator — injects quality standards into theme generation prompts";
  readonly version = "1.0.0";

  async execute(
    input: PremiumUiOptions,
    ctx: GenerationContext,
  ): Promise<SkillResult<PremiumUiOutput>> {
    const start = Date.now();
    this.logs = [];

    const idea = ctx.idea?.toLowerCase() ?? "";
    const includesEcommerce =
      input.includeEcommerce ??
      /shop|store|ecommerce|e-commerce|woocommerce|product|cart|checkout|sell/i.test(idea);

    const uiBlock = buildPremiumUiBlock(ctx, input);
    this.log(`Premium UI block built (ecommerce: ${includesEcommerce})`);

    return this.buildResult(true, { uiBlock, includesEcommerce }, start);
  }
}

export const premiumUiSkill = new PremiumUiSkill();
