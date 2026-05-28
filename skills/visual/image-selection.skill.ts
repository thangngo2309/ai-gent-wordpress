/**
 * Image Selection Skill.
 *
 * Provides industry-specific image and visual content strategy rules.
 * Since WordPress themes can't embed external photos, this skill guides
 * the LLM to generate meaningful inline SVGs, CSS compositions, and
 * contextual placeholder visuals that look intentional — never empty boxes.
 *
 * Every section must have a visual element. This skill specifies WHAT those
 * visuals should be and HOW to compose them for each industry.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { detectIndustry, type IndustryCategory } from "./color-harmony.skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  STRATEGY RULES PER INDUSTRY
// ─────────────────────────────────────────────────────────────────────────────

interface ImageStrategy {
  heroVisual: string;
  featureVisuals: string[];
  productVisuals: string;
  sectionAccents: string;
  backgroundPatterns: string;
  neverDo: string[];
}

const STRATEGIES: Record<IndustryCategory, ImageStrategy> = {
  energy: {
    heroVisual: "A multi-layered SVG composition: background dark navy rect (rx:24), overlapping translucent hexagons in cyan/blue tones representing battery cells, bright cyan lines connecting cells to suggest current flow, floating stat cards (\"98% Efficiency\", \"10 Year Warranty\") as white cards with shadows positioned in lower-left.",
    featureVisuals: [
      "Battery cell cluster: 3×4 grid of rounded rectangles with individual charge-level fills using cyan gradient, connected by thin lines",
      "Energy flow diagram: horizontal arrow with branching lines and node circles, animated SVG with subtle pulse on circles",
      "EV car silhouette: simplified geometric side-view with battery indicator glow underneath",
      "Solar panel grid: tilted isometric-style grid of rectangles with cross-hatch pattern and sun rays",
    ],
    productVisuals: "Rectangular battery module with top terminals, metallic gradient casing (linear-gradient from #2d6ea0 to #1d4466), green charge level indicator, certification badge icons (UL, CE, ISO) in bottom row.",
    sectionAccents: "Diagonal cyan glow dividers, hexagonal grid patterns as section backgrounds at 3% opacity, energy waveform (sine wave) as section separator.",
    backgroundPatterns: "SVG circuit board pattern (thin lines at 90°/45° angles with small circles at intersections) at 4% opacity on --color-bg-secondary sections.",
    neverDo: [
      "Plain grey placeholder boxes",
      "Generic stock photo placeholders",
      "Empty white rectangles with just a border",
      "Clipart lightning bolts",
      "Flat blue squares with no detail",
    ],
  },

  industrial: {
    heroVisual: "SVG factory silhouette: building outline with chimneys, gears in the foreground (two interlocking circles with tooth patterns), radial gauge/dial in the upper-right corner showing 98%, subtle grid overlay on background.",
    featureVisuals: [
      "Precision gear assembly: two to three interlocking gear SVGs with varying sizes, stroke-only style in primary color",
      "Industrial gauge: circle with tick marks, pointer arrow, and percentage label in center",
      "Production line: horizontal conveyor with rectangular pieces and an animated motion indicator",
      "Quality badge: shield with checkmark and ISO number",
    ],
    productVisuals: "Industrial equipment card: dark slate header with product category tag, dimensions diagram with arrows and labels, certification icons in a row (ISO 9001, CE mark, custom), weight/capacity specification grid.",
    sectionAccents: "Diagonal hash marks on section borders, industrial steel plate texture via SVG pattern (crosshatch at 45°), yellow warning-tape accent strip for important sections.",
    backgroundPatterns: "Subtle grid pattern (10px squares, 1px lines) at 4% opacity as section background texture.",
    neverDo: [
      "Fluffy lifestyle imagery",
      "Soft pastel gradients",
      "Rounded-corner everything",
      "Emoji icons",
    ],
  },

  ecommerce: {
    heroVisual: "Fashion/lifestyle composition: tall 4:3 product mock-up frame with gradient overlay, floating review star badge (5 stars, \"2.4k Reviews\"), discount badge (-30%), subtle confetti dots as background accents.",
    featureVisuals: [
      "Shopping bag with heart icon: bold filled SVG in accent color",
      "Free shipping van: side-view delivery van silhouette with motion lines",
      "Returns badge: circular arrow with checkmark",
      "Secure payment shield: lock inside shield",
    ],
    productVisuals: "Product card: 4:3 aspect-ratio image area with gradient fill (primary-light to primary) as placeholder, product name in bold, price with original strikethrough, star rating row, Add to Cart button full-width.",
    sectionAccents: "Color-pop circular blobs in accent color at 15% opacity as background accents, ribbon banners for sale sections, badge overlays (\"NEW\", \"BESTSELLER\") on product cards.",
    backgroundPatterns: "Subtle polka-dot pattern at 3% opacity on alternating sections, or diagonal stripes at 2% opacity.",
    neverDo: [
      "Grey image placeholders",
      "Wireframe boxes",
      "Lorem ipsum product descriptions",
      "Missing price or CTA",
    ],
  },

  saas: {
    heroVisual: "Product dashboard mock-up: dark card (bg: #0f172a) with colored chart bars/lines inside, pill-shaped status indicators (green 'Live', yellow 'Processing'), floating metric cards ('99.9% Uptime', '+24% Growth'). Or: abstract isometric 3D block composition in primary/accent colors.",
    featureVisuals: [
      "Analytics chart: bar chart SVG with 6 bars in varying primary shades, animated growing bars",
      "API connection: two boxes connected by dotted arrow lines with data packets (small squares) moving along",
      "Dashboard gauge: donut chart showing 87% completion in primary color",
      "Integration grid: 3x3 grid of app logo placeholders (colored squares with first letter) connected by lines to a center hub",
    ],
    productVisuals: "Pricing card: gradient header with plan name, large price number, feature list with checkmark icons, highlighted 'Most Popular' badge on center card, CTA button full-width.",
    sectionAccents: "Glow effects (box-shadow with primary color at 40% opacity) on featured cards, gradient text on headlines, code block snippets as visual accents in tech sections.",
    backgroundPatterns: "Dot grid pattern at 5% opacity, or subtle mesh gradient (radial gradient from primary-light in top-right corner).",
    neverDo: [
      "Stock photos of people on phones",
      "Flat boring rectangles",
      "Generic charts with no data",
      "Primary color at 100% saturation everywhere",
    ],
  },

  healthcare: {
    heroVisual: "Clean medical composition: large teal circle (semi-transparent) as background accent, simple human figure outline with a heartbeat line, floating stat cards ('500+ Patients Served', '15+ Years Experience'), cross/plus symbol in primary color.",
    featureVisuals: [
      "Heartbeat/ECG line: SVG path drawing a medical heart rhythm waveform",
      "Medical cross: plus symbol in rounded rect container, primary teal color",
      "Doctor profile placeholder: circular frame with abstract person silhouette",
      "Shield with cross: protection/trust icon in teal",
    ],
    productVisuals: "Service card: circular icon container (teal bg, white icon), service name in bold, short description, 'Learn More' link with arrow. Clean white cards with soft shadow.",
    sectionAccents: "Soft wavy dividers between sections (SVG wave path), green leaf/nature accents for wellness, gentle gradient overlays (white to primary-light).",
    backgroundPatterns: "Very subtle leaf or cross pattern at 3% opacity for wellness; clean white with colored left-border accents for medical.",
    neverDo: [
      "Red/blood colors",
      "Dark aggressive color schemes",
      "Complex diagrams without labels",
      "Blurry or low-quality medical imagery",
    ],
  },

  food: {
    heroVisual: "Warm appetizing composition: circular image frame with organic shape (not perfect circle), warm amber/orange gradient blob behind it, floating 'Order Now' card with fork-knife icon, star rating badge, dish name in serif font.",
    featureVisuals: [
      "Fork and knife cross: elegant cutlery SVG in primary warm brown",
      "Chef's hat: simple white toque silhouette on colored circle",
      "Clock with steam: hot food indicator icon",
      "Location pin: stylized map pin for restaurant location",
    ],
    productVisuals: "Menu/dish card: warm oval or rounded-rect image frame with appetizing gradient placeholder (amber to orange), dish name in Playfair Display font, price in accent color, dietary tags (Vegan, Spicy) as small pills.",
    sectionAccents: "Organic blob shapes in warm background sections, illustrated food ingredient motifs (wheat, pepper, leaf) as section decorations at low opacity.",
    backgroundPatterns: "Subtle burlap or linen texture at 4% opacity via SVG filter, or organic circular spot patterns in warm tones.",
    neverDo: [
      "Cold blue color schemes",
      "Sharp geometric patterns that feel sterile",
      "Missing pricing on menu items",
      "Empty oval placeholders with no texture",
    ],
  },

  realestate: {
    heroVisual: "Premium property composition: large rounded-corner house/building silhouette SVG in forest green, floating property details card ('3 Beds • 2 Baths • 220 m²'), key icon accent, subtle map pin indicators around the visual.",
    featureVisuals: [
      "House silhouette: classic home outline SVG, stroke style in primary green",
      "Location pin on map: simplified map with highlighted area",
      "Key icon: door key SVG in gold/accent color",
      "Scale/floor plan icon: overhead house blueprint view",
    ],
    productVisuals: "Property listing card: 16:9 image frame with gradient placeholder (green to dark green), property name, address line, specifications row (m², beds, baths) with icons, price in accent gold, Contact Agent CTA button.",
    sectionAccents: "Subtle topographic line pattern as background texture, gold accent borders on featured listings, architectural blueprint grid on about/team sections.",
    backgroundPatterns: "Minimal topographic lines at 4% opacity for prestige feel, or subtle leaf pattern for eco/sustainable properties.",
    neverDo: [
      "Low-resolution map placeholders",
      "Missing square footage or pricing",
      "Dark heavy color schemes that feel oppressive",
      "Busy patterns that distract from property details",
    ],
  },

  finance: {
    heroVisual: "Trust-building financial composition: dark slate background, rising line chart SVG (smooth bezier curve going up-right) in emerald color, floating metric cards ('$2.4M AUM', '+18.3% YTD'), padlock security icon, subtle number ticker animation.",
    featureVisuals: [
      "Rising line chart: smooth SVG bezier path going upward, emerald color on dark bg",
      "Shield with lock: security/protection icon in primary dark",
      "Pie chart: donut chart showing portfolio allocation in 3-4 segments",
      "Currency/coin stack: stylized coin pile SVG in gold accent",
    ],
    productVisuals: "Financial product card: clean white card with left-border accent in emerald, product name, key metric (return rate, APY), risk level indicator (colored pill), minimum investment text, CTA button.",
    sectionAccents: "Sophisticated thin-line dividers, number counters as visual elements ('$50B+ Managed', '200k+ Investors'), grid of trust badges (SEC, FINRA, FDIC) in greyscale.",
    backgroundPatterns: "Very subtle graph paper grid at 3% opacity, or minimal diagonal lines at 2% opacity for data/analytics feel.",
    neverDo: [
      "Flashy neon colors",
      "Exaggerated returns claims without context",
      "Cartoon-style icons",
      "Distracting animations on financial data",
    ],
  },

  education: {
    heroVisual: "Learning-focused composition: illustrated open book or graduation cap SVG in blue, floating course cards ('12 Lessons', 'Certificate Included'), progress bar showing 73% completion, student avatar cluster (circles in a row).",
    featureVisuals: [
      "Open book: classic book SVG with pages spread, primary blue",
      "Graduation cap: mortarboard icon in primary color",
      "Play button circle: course video indicator",
      "Certificate ribbon: award ribbon SVG in orange accent",
    ],
    productVisuals: "Course card: 16:9 thumbnail frame with category color gradient, course title in bold, instructor avatar with name, star rating, lesson count badge, 'Enroll Now' button.",
    sectionAccents: "Pencil/pen line decorations in orange accent, quiz/checklist visual motifs, progress ring animations for completion stats.",
    backgroundPatterns: "Notebook line pattern at 4% opacity, or pencil-mark diagonal stripes at 3%.",
    neverDo: [
      "Boring flat table layouts",
      "Missing instructor or curriculum info",
      "Lack of progress or achievement indicators",
      "Corporate-looking design that feels impersonal",
    ],
  },

  default: {
    heroVisual: "Clean professional composition: large rounded-corner card in primary color gradient as background visual, floating achievement/stat cards ('10k+ Clients', '99% Satisfaction'), primary colored geometric shapes as accents.",
    featureVisuals: [
      "Abstract feature icon: rounded square with centered SVG icon in primary color",
      "Check circle: large outlined check in primary, used for benefit lists",
      "Arrow right circle: forward/action indicator",
      "Star badge: rating/quality indicator in accent amber",
    ],
    productVisuals: "Service/product card: clean white with top color accent bar, icon, title, description, and CTA link.",
    sectionAccents: "Subtle diagonal color strips for section separators, colored left-border on feature cards, floating stat cards as visual interest.",
    backgroundPatterns: "Minimal dot grid at 4% opacity, or subtle mesh gradient from top-right corner.",
    neverDo: [
      "Empty grey boxes",
      "Lorem ipsum content",
      "Missing CTAs",
      "Flat sections with zero visual interest",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildImageStrategyRules(idea: string): string {
  const industry = detectIndustry(idea);
  const strategy = STRATEGIES[industry];

  const neverList = strategy.neverDo.map(n => `  ✗ ${n}`).join("\n");
  const featureList = strategy.featureVisuals.map((f, i) => `  ${i + 1}. ${f}`).join("\n");

  return `
IMAGE & VISUAL CONTENT STRATEGY

HERO SECTION VISUAL:
${strategy.heroVisual}

FEATURE/BENEFIT SECTION VISUALS (use these for icon areas):
${featureList}

PRODUCT / SERVICE CARD VISUALS:
${strategy.productVisuals}

SECTION ACCENT ELEMENTS:
${strategy.sectionAccents}

BACKGROUND PATTERNS (apply at low opacity):
${strategy.backgroundPatterns}

VISUAL COMPOSITION RULES:
- Every section MUST have at least one visual element (icon, SVG, pattern, or graphic).
- Hero section MUST have a rich multi-element visual composition on the right column.
- Product/service cards MUST have a colored image frame — never an empty white box.
- Use CSS aspect-ratio to lock frame sizes; fill with gradient + SVG, not blank space.
- SVG illustrations must use var(--color-primary), var(--color-accent), and white fills ONLY.
- All SVG icons: 24×24 viewBox, 2px stroke, stroke-linecap="round", stroke-linejoin="round".
- Inline SVGs go directly in HTML — no external src="" for decorative graphics.

FORBIDDEN VISUAL PATTERNS:
${neverList}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface ImageSelectionInput { idea: string }
export interface ImageSelectionOutput { industry: IndustryCategory; rules: string }

export class ImageSelectionSkill extends BaseSkill<ImageSelectionInput, ImageSelectionOutput> {
  readonly name = "visual/image-selection";
  readonly description = "Industry-specific image and visual content strategy for premium WordPress themes";
  readonly version = "1.0.0";

  async execute(
    input: ImageSelectionInput,
    _ctx: GenerationContext,
  ): Promise<SkillResult<ImageSelectionOutput>> {
    const start = Date.now();
    this.logs = [];
    const industry = detectIndustry(input.idea);
    this.log(`Image strategy: ${industry}`);
    return this.buildResult(true, {
      industry,
      rules: buildImageStrategyRules(input.idea),
    }, start);
  }
}

export const imageSelectionSkill = new ImageSelectionSkill();
