/**
 * Image Rendering Skill
 *
 * Provides WordPress-specific image implementation rules for proper rendering:
 * - WordPress thumbnail functions with graceful fallbacks
 * - WooCommerce product image functions
 * - CSS aspect-ratio + object-fit enforcement
 * - SVG placeholder design standards (never plain gradient boxes)
 */

// ─────────────────────────────────────────────────────────────────────────────
//  IMAGE RENDERING RULES BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildImageRenderingRules(): string {
  return `
════════════════════════════════════════════════════════════════════════════════
IMAGE RENDERING SYSTEM — CRITICAL IMPLEMENTATION RULES
════════════════════════════════════════════════════════════════════════════════

## A. WORDPRESS POST/PAGE THUMBNAIL PATTERN (mandatory)

Always check before rendering. Never render a broken img tag:

\`\`\`php
<?php if ( has_post_thumbnail() ) : ?>
  <div class="card__image">
    <?php the_post_thumbnail( 'large', [
      'class'   => 'card__img',
      'loading' => 'lazy',
      'alt'     => get_the_title(),
    ] ); ?>
  </div>
<?php else : ?>
  <div class="card__image card__image--placeholder" aria-hidden="true">
    <!-- Industry-relevant inline SVG fallback with label -->
    <svg viewBox="0 0 400 300" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="400" height="300" fill="var(--color-primary)" opacity="0.08"/>
      <!-- Industry icon / illustration in center -->
    </svg>
  </div>
<?php endif; ?>
\`\`\`

## B. WOOCOMMERCE PRODUCT IMAGE PATTERN (mandatory)

For single product pages:
\`\`\`php
<?php
global $product;
echo $product->get_image( 'woocommerce_single', [
  'class'   => 'product-single__img',
  'loading' => 'eager',
] );
?>
\`\`\`

For product loops/cards:
\`\`\`php
<?php
global $product;
$img_html = $product->get_image( 'woocommerce_thumbnail', [
  'class' => 'product-card__img',
  'loading' => 'lazy',
] );
if ( $img_html ) {
  echo '<div class="product-card__image">' . $img_html . '</div>';
} else {
  echo '<div class="product-card__image product-card__image--placeholder">';
  // inline SVG fallback
  echo '</div>';
}
?>
\`\`\`

## C. IMAGE CONTAINER CSS (mandatory — copy exactly into style.css)

\`\`\`css
/* ── Image container base ── */
.card__image,
.product-card__image,
.post-card__image,
.hero__image {
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-lg, 12px);
  background-color: var(--color-surface-secondary, #f0f0f0);
  position: relative;
  display: block;
}

/* Wide-format variants */
.post-card__image,
.editorial-card__image {
  aspect-ratio: 16 / 9;
}

/* Portrait variant for product details */
.product-single__image {
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: var(--radius-xl, 16px);
  background-color: var(--color-surface-secondary, #f0f0f0);
  position: relative;
}

/* ── img element rules (apply to ALL images inside containers) ── */
.card__image img,
.card__img,
.product-card__image img,
.product-card__img,
.post-card__image img,
.post-card__img,
.hero__image img,
.hero__img,
.product-single__image img,
.product-single__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  transition: transform 0.35s ease;
}

/* ── Hover zoom on cards ── */
@media (prefers-reduced-motion: no-preference) {
  .card:hover .card__img,
  .product-card:hover .product-card__img,
  .post-card:hover .post-card__img {
    transform: scale(1.06);
  }
}

/* ── SVG placeholder fills the container ── */
.card__image--placeholder svg,
.product-card__image--placeholder svg,
.post-card__image--placeholder svg {
  width: 100%;
  height: 100%;
  display: block;
}
\`\`\`

## D. SVG PLACEHOLDER DESIGN STANDARDS

FORBIDDEN ✗:
- Plain \`background: linear-gradient(...)\` boxes with no content
- Empty div with only a background color
- Solid color rectangles with no visual meaning
- Tiny 100×100 SVGs inside a large image frame

REQUIRED ✓:
- Inline SVG with viewBox="0 0 400 300" (or appropriate ratio)
- Centered industry-relevant icon or illustration (at minimum 80×80 area)
- Use CSS custom properties for colors: var(--color-primary), var(--color-accent)
- Include a subtle label or caption text element in the SVG for context
- Use opacity layers for depth: a light fill rect behind the main icon
- The SVG must FILL the container — set width="100%" height="100%" on the svg element
- Add aria-hidden="true" to decorative SVGs

Example good placeholder for a battery/energy product:
\`\`\`html
<div class="product-card__image product-card__image--placeholder" aria-hidden="true">
  <svg width="100%" height="100%" viewBox="0 0 400 300" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="300" fill="var(--color-primary)" opacity="0.07"/>
    <rect x="140" y="60" width="120" height="160" rx="12" fill="var(--color-primary)" opacity="0.15" stroke="var(--color-primary)" stroke-width="2"/>
    <rect x="165" y="45" width="25" height="20" rx="4" fill="var(--color-primary)" opacity="0.4"/>
    <rect x="210" y="45" width="25" height="20" rx="4" fill="var(--color-primary)" opacity="0.4"/>
    <rect x="155" y="90" width="90" height="110" rx="6" fill="var(--color-accent)" opacity="0.25"/>
    <path d="M190 115 L205 140 H197 V175 L180 150 H188 V115Z" fill="var(--color-accent)" opacity="0.8"/>
  </svg>
</div>
\`\`\`

## E. HERO SECTION VISUAL (not just a gradient background)

The hero visual side MUST be a layered composition, NOT a plain CSS gradient rectangle.

Required hero visual pattern:
\`\`\`html
<div class="hero__visual" aria-hidden="true">
  <!-- Layer 1: Background shape / blob -->
  <div class="hero__visual-bg"></div>
  <!-- Layer 2: Main SVG illustration -->
  <svg class="hero__visual-svg" viewBox="0 0 480 400" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <!-- ... industry-specific illustration ... -->
  </svg>
  <!-- Layer 3: Floating stat/badge card (optional) -->
  <div class="hero__badge">
    <span class="hero__badge-value">10+</span>
    <span class="hero__badge-label">Years Experience</span>
  </div>
</div>
\`\`\`

\`\`\`css
.hero__visual {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hero__visual-bg {
  position: absolute;
  inset: -20%;
  background: radial-gradient(circle at 60% 40%, var(--color-primary), transparent 70%);
  opacity: 0.15;
  border-radius: 50%;
  z-index: 0;
}
.hero__visual-svg {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 480px;
  height: auto;
}
.hero__badge {
  position: absolute;
  bottom: 10%;
  right: -5%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 12px);
  padding: 12px 20px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  z-index: 2;
}
\`\`\`

## F. IMAGE QUALITY CHECKLIST

Before rendering any PHP template:
- [ ] Every product/post card has a dedicated image container div with correct aspect-ratio class
- [ ] WordPress templates use has_post_thumbnail() guard before calling the_post_thumbnail()
- [ ] WooCommerce product cards use $product->get_image() with the thumbnail size argument
- [ ] Every img element inside a container gets the CSS img rules (object-fit: cover)
- [ ] No plain gradient-only placeholder — all SVG fallbacks have meaningful illustrations
- [ ] Hero section uses layered SVG composition, not just a CSS gradient background
- [ ] SVG placeholders fill their container with width="100%" height="100%"
`;
}
