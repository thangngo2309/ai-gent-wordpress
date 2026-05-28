/**
 * Hero Visual Skill.
 *
 * Defines premium hero section visual compositions.
 * The hero is the most important visual impression of any generated site.
 * This skill provides specific, actionable rules for creating heroes that
 * look premium — not like default WordPress starter templates.
 *
 * Key goal: every hero must have a rich multi-layer composition on the right
 * column (or center for centered layouts), not just text on a plain background.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { detectIndustry, type IndustryCategory } from "./color-harmony.skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  INDUSTRY-SPECIFIC HERO COMPOSITIONS
// ─────────────────────────────────────────────────────────────────────────────

const HERO_COMPOSITIONS: Record<IndustryCategory, string> = {
  energy: `
ENERGY/BATTERY HERO COMPOSITION:
  Layout: Two-column (text left, visual right). Min-height: 90vh.
  Background: Deep navy gradient (var(--color-primary-dark) to #0d1b2a).
  Text column: White text with eyebrow in cyan, H1 in white (bold 800), subtitle in muted blue-white.
  CTA pair: btn--primary (filled white/cyan) + btn--secondary (outline white).
  Trust signals row below CTA: "✓ ISO 9001" · "✓ 10-Year Warranty" · "✓ CE Certified" in small text.

  Visual column composition (600px wide):
  ┌─────────────────────────────────────────────┐
  │  [Cyan glow circle, ~400px, 8% opacity]      │
  │  ┌──────────────────────────────────┐        │
  │  │  Battery Pack SVG (viewBox 480×360)│       │
  │  │  - Dark panel background (navy)  │        │
  │  │  - 3×4 grid of battery cells     │        │
  │  │  - Connecting BMS lines (cyan)   │        │
  │  │  - Charge indicators per cell    │        │
  │  └──────────────────────────────────┘        │
  │  [Floating card: "98.5% Efficiency"]         │
  │  [Floating card: "48V / 200Ah"]              │
  └─────────────────────────────────────────────┘

  Floating stat cards: position:absolute, white bg, shadow-xl, border-radius-lg.
  Animation: fade-in-up stagger (100ms, 200ms, 300ms delay on cards).`,

  industrial: `
INDUSTRIAL HERO COMPOSITION:
  Layout: Two-column. Min-height: 85vh.
  Background: Light (white to bg-secondary) OR dark slate — choose based on site tone.
  H1: "Industrial Precision. Engineered to Last." style headline — strength words.
  Text: Left-aligned, serif or Barlow heading font.
  CTA: "Get a Quote" (primary filled) + "View Our Work" (secondary outline).

  Visual column:
  - Large industrial facility/machinery illustration: line-art SVG style.
  - Gear pair (large + small) interlocking with subtle rotation animation.
  - Quality badge overlay: "ISO 9001:2015 Certified" gold badge.
  - Stat overlays: "25+ Years", "500+ Projects", "98% On-Time".
  - Background: subtle crosshatch pattern at 4% opacity.`,

  ecommerce: `
ECOMMERCE HERO COMPOSITION:
  Layout: Two-column OR full-bleed with centered overlay text.
  Background: Near-white or brand dark — high contrast for product pop.
  H1: Short product/brand promise headline (max 8 words), huge, bold.
  CTA: "Shop Now" (large, accent orange) + "View Collection" (ghost).
  Social proof bar below CTAs: stars + "4.9/5 from 12,400 reviews".

  Visual column:
  - Hero product display: tall portrait aspect (3:4), gradient placeholder with product category icon inside.
  - Sale badge: diagonal ribbon in accent color, top-left corner.
  - Discount badge: round pill ("-30%") on product frame corner.
  - Review snippet card: floating white card with star row + quote text.
  - Trust bar: icons for "Free Shipping", "Easy Returns", "Secure Payment".`,

  saas: `
SAAS HERO COMPOSITION:
  Layout: Centered headline with product screenshot/dashboard below, OR split with demo visual.
  Background: White OR very subtle gradient mesh (radial gradients).
  H1: Benefit-first headline, 2-3 lines, with gradient text on key word (CSS gradient-text).
  CTA pair: "Start Free Trial" (large filled primary) + "See a Demo" (ghost with play icon).
  Social proof: logos of 5-6 company logos in greyscale below CTAs, labeled "Trusted by".

  Visual (hero product mock-up):
  - Browser chrome (rounded top, 3 dots, URL bar).
  - Dashboard inside: stat cards + bar chart + data table preview.
  - Floating notification cards ("Deal closed: +$12,000") positioned around screenshot.
  - Glow: radial gradient in primary color at 20% opacity behind screenshot.
  - Subtle grid background for tech/data context.`,

  healthcare: `
HEALTHCARE HERO COMPOSITION:
  Layout: Centered OR split. Clean, breathable.
  Background: Clean white OR very soft teal tint.
  H1: Patient-focused headline: "Your Health, Our Priority" style.
  Tone: Warm, trusting. NOT clinical or cold.
  CTA: "Book Appointment" (teal filled) + "Learn More" (ghost).
  Trust signals: "500+ Patients", "15+ Years Experience", "Board Certified".

  Visual:
  - Warm circular illustration: doctor/team silhouette OR medical service icons in soft teal circles.
  - ECG waveform as decorative background strip.
  - Patient review card: photo placeholder circle + name + rating + quote.
  - Soft blob shapes in teal/primary-light at low opacity as backgrounds.`,

  food: `
FOOD HERO COMPOSITION:
  Layout: Split OR full-width with overlay. Warm, inviting.
  Background: Warm cream/amber — never cold white.
  H1: Sensory headline: "Taste the Craft. Feel the Warmth."
  Font: Playfair Display or serif for heading — elegant warmth.
  CTA: "Reserve a Table" + "View Menu".
  Ambient details: opening hours, address, tagline.

  Visual:
  - Organic circle frame (not perfect circle — slight blob shape) for hero dish.
  - Warm gradient fill inside the frame (amber-to-orange) as placeholder.
  - Steam/warmth indicator: 3 wavy SVG paths above the dish.
  - Fork and knife flanking the image, elegant SVG lines.
  - Rating badge overlay: 5 gold stars + "Google: 4.9/5".
  - Background: warm organic blob shapes in cream/amber.`,

  realestate: `
REAL ESTATE HERO COMPOSITION:
  Layout: Full-width with overlay text OR split with property visual.
  Background: Forest green dark OR crisp white — premium either way.
  H1: Location-focused: "Find Your Dream Home in [City]"
  Search bar: featured search widget with city, type, price range — primary CTA is this search.
  Secondary CTA: "Browse Listings" + "Sell Your Property".

  Visual:
  - Property illustration: elegant house silhouette SVG with landscape.
  - OR: stacked property listing cards at slight angle (CSS perspective).
  - Map pin cluster suggesting properties in an area.
  - Key stat overlays: "200+ Active Listings", "Top 1% Agents".
  - Background: subtle topographic lines pattern.`,

  finance: `
FINANCE HERO COMPOSITION:
  Layout: Dark hero (builds authority and trust). Split OR centered.
  Background: Dark slate (#020617 or #0f172a) — authoritative, premium.
  H1: Growth-focused: "Grow Your Wealth. Protect Your Future."
  Text: White with muted secondary text.
  CTA: "Start Investing" (emerald filled) + "Learn More" (ghost white).
  Compliance text: "SEC Registered Investment Adviser" in small footer text.

  Visual:
  - Dark panel with rising line chart SVG in emerald.
  - Area fill below line in emerald at 15% opacity.
  - Floating metric cards: "Annual Return", "AUM", "Investors".
  - Security badge: shield + padlock icon prominently placed.
  - Subtle grid lines on dark background for data context.`,

  education: `
EDUCATION HERO COMPOSITION:
  Layout: Split (text left, course previews right) OR centered with social proof.
  Background: Clean white OR deep blue — depends on brand tone.
  H1: Outcome-focused: "Learn Skills That Get You Hired."
  CTA: "Browse Courses" (large blue filled) + "Try Free" (ghost).
  Social proof: student count + rating score + partner company logos.

  Visual (course card stack):
  - 3 overlapping course card previews at slight angles (CSS rotation).
  - Each card: category color header, course thumbnail placeholder, title, instructor.
  - Progress indicator on front card showing "73% enrolled".
  - Floating badges: "Certificate Included", "Lifetime Access".
  - Student avatar row: 5+ circular avatars overlapping in a row.`,

  default: `
GENERAL HERO COMPOSITION:
  Layout: Two-column (text left, visual right).
  Background: White OR primary-dark for a bold statement.
  H1: Clear value proposition headline, clamp(2.5rem, 5vw, 4rem).
  CTA pair: Primary filled + secondary outline.
  Trust signals below CTA.

  Visual column:
  - Abstract illustration relevant to the business type.
  - Floating achievement/stat cards: "10k+ Clients", "99% Uptime".
  - Background blob: large circle in primary color at 8% opacity.
  - Decorative dots grid pattern at low opacity.
  - Subtle entrance animation: fade-in-up on cards.`,
};

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildHeroVisualRules(idea: string): string {
  const industry = detectIndustry(idea);
  const composition = HERO_COMPOSITIONS[industry];

  return `
HERO SECTION VISUAL SYSTEM

HERO UNIVERSAL RULES:
- Hero is the FIRST thing visitors see. It MUST be visually rich and premium.
- Background MUST be something other than plain white: gradient, dark, tinted, or patterned.
- Hero always has a clear visual composition on the non-text side.
- CTA buttons in hero: always two — primary (filled) and secondary (outline/ghost).
- Trust signals below CTAs: certifications, review scores, client count, or awards.
- H1 uses clamp(2.5rem, 5vw, 4rem) — never a fixed px value.
- Hero text column: max 540px wide; left-aligned (not centered unless full-bleed).
- Mobile: stack to single column, visual below text.

HERO ANIMATION RULES:
- Text block: fadeInUp 600ms ease-out 0ms.
- CTA buttons: fadeInUp 600ms ease-out 150ms.
- Stat cards: fadeInUp 600ms ease-out 300ms, 400ms, 500ms (stagger).
- The hero visual SVG: fadeIn 800ms ease-out 200ms.
- NO aggressive bouncing, no slide-in-from-left (subtle only).

CSS HERO STRUCTURE:
  .hero {
    min-height: 90vh;
    display: flex;
    align-items: center;
    padding: 5rem 1.5rem;
    position: relative;
    overflow: hidden;
  }
  .hero .container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4rem;
    align-items: center;
  }
  .hero__content { max-width: 540px; }
  .hero__eyebrow { /* uppercase tracking-wide primary color label */ }
  .hero__title { font-size: clamp(2.5rem, 5vw, 4rem); font-weight: 800; line-height: 1.1; }
  .hero__subtitle { font-size: 1.125rem; line-height: 1.7; color: var(--color-text-secondary); margin: 1.5rem 0; }
  .hero__cta { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; }
  .hero__trust { margin-top: 2rem; display: flex; gap: 2rem; font-size: 0.875rem; color: var(--color-text-muted); }
  .hero__visual { position: relative; }

INDUSTRY-SPECIFIC COMPOSITION:
${composition}

HERO FORBIDDEN PATTERNS:
  ✗ Plain white background with no gradient or pattern
  ✗ Hero with text only (no visual on the non-text side)
  ✗ Single CTA button (always two)
  ✗ H1 using a fixed px size instead of clamp()
  ✗ Generic "Welcome to Our Website" headlines
  ✗ Missing trust signals / social proof
  ✗ Centered text with NO supporting visual element
  ✗ Hero background: linear-gradient(to right, #fff, #f8fafc) — too subtle`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface HeroVisualInput { idea: string }
export interface HeroVisualOutput { industry: IndustryCategory; rules: string }

export class HeroVisualSkill extends BaseSkill<HeroVisualInput, HeroVisualOutput> {
  readonly name = "visual/hero-visual";
  readonly description = "Industry-specific premium hero section visual compositions";
  readonly version = "1.0.0";

  async execute(
    input: HeroVisualInput,
    _ctx: GenerationContext,
  ): Promise<SkillResult<HeroVisualOutput>> {
    const start = Date.now();
    this.logs = [];
    const industry = detectIndustry(input.idea);
    this.log(`Hero composition: ${industry}`);
    return this.buildResult(true, {
      industry,
      rules: buildHeroVisualRules(input.idea),
    }, start);
  }
}

export const heroVisualSkill = new HeroVisualSkill();
