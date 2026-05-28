/**
 * Gallery Layout Skill.
 *
 * Provides responsive image gallery, product showcase, and
 * media-heavy section layout patterns for WordPress themes.
 *
 * These layouts ensure visual richness beyond simple text-and-icon grids —
 * they create real visual hierarchies using structured CSS grid/flex patterns,
 * aspect-ratio locking, and deliberate asymmetry for visual interest.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  LAYOUT PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

export function buildGalleryLayoutRules(): string {
  return `
GALLERY & VISUAL LAYOUT PATTERNS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATTERN 1 — PRODUCT CARD GRID (E-commerce / Product Listings)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML structure:
  <div class="product-grid">
    <article class="product-card">
      <a class="product-card__image-wrap" href="...">
        <div class="product-card__image" style="background: linear-gradient(135deg, var(--color-primary-light), var(--color-bg-secondary))">
          <!-- Inline SVG product category illustration -->
        </div>
        <span class="product-card__badge">New</span>
      </a>
      <div class="product-card__body">
        <p class="product-card__category">Category</p>
        <h3 class="product-card__title"><a href="...">Product Name</a></h3>
        <div class="product-card__rating">
          <!-- 5 star SVGs, 16×16 -->
          <span class="product-card__rating-count">(47)</span>
        </div>
        <div class="product-card__footer">
          <span class="product-card__price">$299</span>
          <button class="btn btn--primary btn--sm">Add to Cart</button>
        </div>
      </div>
    </article>
  </div>

CSS:
  .product-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 2rem;
  }
  .product-card {
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: white;
    box-shadow: var(--shadow-card);
    transition: transform var(--transition-normal), box-shadow var(--transition-normal);
  }
  .product-card:hover {
    transform: translateY(-6px);
    box-shadow: var(--shadow-card-hover);
  }
  .product-card__image-wrap { display: block; position: relative; }
  .product-card__image {
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .product-card__badge {
    position: absolute;
    top: 12px; left: 12px;
    background: var(--color-accent);
    color: white;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .product-card__body { padding: 1.25rem; }
  .product-card__category { font-size: 0.75rem; color: var(--color-primary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5rem; }
  .product-card__title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.5rem; line-height: 1.3; }
  .product-card__rating { display: flex; align-items: center; gap: 4px; margin-bottom: 0.75rem; color: #f59e0b; }
  .product-card__footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 1rem; }
  .product-card__price { font-size: 1.25rem; font-weight: 700; color: var(--color-primary); }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATTERN 2 — FEATURE SHOWCASE (Alternating Image + Text Rows)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML:
  <section class="feature-rows">
    <div class="feature-row">
      <div class="feature-row__visual">
        <!-- SVG illustration, aspect-ratio: 4/3 -->
      </div>
      <div class="feature-row__content">
        <span class="eyebrow">Feature Label</span>
        <h3>Feature Headline</h3>
        <p>Feature description text...</p>
        <ul class="feature-row__checklist">
          <li><!-- check-circle icon --> Benefit point one</li>
          <li><!-- check-circle icon --> Benefit point two</li>
        </ul>
        <a href="#" class="btn btn--secondary">Learn More <svg><!-- arrow-right --></svg></a>
      </div>
    </div>
    <!-- Second row: reverse layout (visual right) -->
    <div class="feature-row feature-row--reverse">...</div>
  </section>

CSS:
  .feature-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4rem;
    align-items: center;
    padding: 4rem 0;
  }
  .feature-row--reverse { direction: rtl; }
  .feature-row--reverse > * { direction: ltr; }
  .feature-row__visual {
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-xl);
    overflow: hidden;
    background: var(--color-primary-light);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .feature-row__content { max-width: 480px; }
  .feature-row__checklist { list-style: none; padding: 0; margin: 1rem 0; display: flex; flex-direction: column; gap: 0.75rem; }
  .feature-row__checklist li { display: flex; align-items: center; gap: 12px; font-size: 1rem; }
  @media (max-width: 768px) {
    .feature-row { grid-template-columns: 1fr; }
    .feature-row--reverse { direction: ltr; }
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATTERN 3 — MASONRY GALLERY (Portfolio / Work Showcase)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML:
  <div class="gallery-masonry">
    <div class="gallery-item gallery-item--tall"><!-- visual --></div>
    <div class="gallery-item"><!-- visual --></div>
    <div class="gallery-item"><!-- visual --></div>
    <div class="gallery-item gallery-item--wide"><!-- visual --></div>
    <div class="gallery-item"><!-- visual --></div>
    <div class="gallery-item gallery-item--tall"><!-- visual --></div>
  </div>

CSS:
  .gallery-masonry {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-auto-rows: 240px;
    gap: 1rem;
  }
  .gallery-item {
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-primary-light);
    position: relative;
  }
  .gallery-item--tall { grid-row: span 2; }
  .gallery-item--wide { grid-column: span 2; }
  .gallery-item__overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.6), transparent);
    opacity: 0;
    transition: opacity var(--transition-normal);
    display: flex; align-items: flex-end; padding: 1.25rem;
    color: white;
  }
  .gallery-item:hover .gallery-item__overlay { opacity: 1; }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATTERN 4 — LOGO CAROUSEL (Social Proof / Partners / Clients)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML:
  <section class="logo-strip">
    <p class="logo-strip__label">Trusted by industry leaders</p>
    <div class="logo-strip__track">
      <div class="logo-strip__logos">
        <!-- 6-8 company "logos": styled text or simple SVG lettermarks -->
        <div class="logo-strip__logo">CompanyName</div>
        ...
      </div>
    </div>
  </section>

CSS:
  .logo-strip { padding: 3rem 1.5rem; background: var(--color-bg-secondary); }
  .logo-strip__label { text-align: center; font-size: 0.875rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 2rem; }
  .logo-strip__track { overflow: hidden; }
  .logo-strip__logos {
    display: flex;
    gap: 3rem;
    align-items: center;
    animation: logoScroll 20s linear infinite;
  }
  .logo-strip__logo {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-text-muted);
    white-space: nowrap;
    filter: grayscale(1);
    opacity: 0.6;
    transition: opacity var(--transition-normal), filter var(--transition-normal);
  }
  .logo-strip__logo:hover { filter: grayscale(0); opacity: 1; }
  @keyframes logoScroll {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GALLERY UNIVERSAL RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - EVERY image frame uses aspect-ratio property (never fixed heights on image containers).
  - NEVER use empty white boxes — always gradient + SVG placeholder inside frames.
  - Image frames use rounded corners from the design token scale (--radius-lg or --radius-xl).
  - On mobile (<768px): product grids collapse to 2 columns min (minmax(160px, 1fr)).
  - On mobile (<480px): product grids collapse to single column.
  - Gallery items always have hover state feedback (lift, shadow increase, or overlay reveal).
  - Alt text attributes on all <img> elements (use descriptive text, not "image").
  - For inline SVG illustrations inside frames: they inherit the frame background and are centered.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface GalleryLayoutOutput { rules: string }

export class GalleryLayoutSkill extends BaseSkill<undefined, GalleryLayoutOutput> {
  readonly name = "visual/gallery-layout";
  readonly description = "Responsive gallery, product showcase, and media-heavy section layout patterns";
  readonly version = "1.0.0";

  async execute(
    _input: undefined,
    _ctx: GenerationContext,
  ): Promise<SkillResult<GalleryLayoutOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log("Gallery layout patterns loaded");
    return this.buildResult(true, { rules: buildGalleryLayoutRules() }, start);
  }
}

export const galleryLayoutSkill = new GalleryLayoutSkill();
