/**
 * Illustration Skill.
 *
 * Provides concrete SVG illustration patterns and CSS composition rules
 * for generating premium, contextual visuals inside WordPress themes.
 *
 * These are NOT generic icon rules (see icon-system.skill.ts).
 * These are medium-to-large decorative and informational illustration
 * patterns used in hero sections, feature sections, and page headers.
 *
 * Key principle: the LLM must embed meaningful inline SVGs — never
 * reference external images for decorative purposes.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { detectIndustry, type IndustryCategory } from "./color-harmony.skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  SVG COMPOSITION PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ARCHITECTURE OF A GOOD INLINE SVG ILLUSTRATION:
 *
 * 1. viewBox="0 0 WIDTH HEIGHT" — always use this, never width/height attributes
 * 2. <defs> block at top with linearGradient, pattern, filter IDs
 * 3. Background layer: rounded rect or circle fill with gradient
 * 4. Mid layer: industry-specific shapes (cells, gears, charts, buildings…)
 * 5. Accent layer: glow effects, highlights, connecting lines
 * 6. Overlay layer: text labels, stat numbers, badge cards (use <foreignObject> or <text>)
 * 7. All colors: use var(--color-primary), var(--color-accent), CSS custom property fills
 */

const SVG_BASE_RULES = `
SVG ILLUSTRATION RULES (apply to ALL inline SVGs):
- viewBox attribute is REQUIRED. Never use fixed width/height attributes on SVG root.
- Use <defs> for gradients, patterns, filters — reference them by id.
- Background shape: always a rounded <rect rx="20"> or large <circle>, never raw white.
- Layer depth: background → mid shapes → connecting elements → accent glows → labels.
- All gradient fills must reference CSS variables inside stop-color: 
    <stop stop-color="var(--color-primary)"/>
- SVG must be responsive: set class="w-full h-auto" or style="width:100%;height:auto".
- For large hero visuals: viewBox="0 0 520 400" is a safe default.
- For feature illustrations: viewBox="0 0 320 240".
- For product/service card headers: viewBox="0 0 400 260".`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  INDUSTRY-SPECIFIC ILLUSTRATION TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

const ILLUSTRATION_TEMPLATES: Record<IndustryCategory, string> = {
  energy: `
ENERGY / BATTERY TECHNOLOGY ILLUSTRATIONS:

Hero Visual Composition (viewBox="0 0 520 400"):
<defs>
  <linearGradient id="heroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="var(--color-primary)"/>
    <stop offset="100%" stop-color="#051929"/>
  </linearGradient>
  <linearGradient id="cellGrad" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0.9"/>
    <stop offset="100%" stop-color="var(--color-accent)" stop-opacity="0.3"/>
  </linearGradient>
</defs>
<!-- Dark background panel -->
<rect x="0" y="0" width="520" height="400" rx="24" fill="url(#heroGrad)"/>
<!-- Battery cell grid: 4 cols x 3 rows of rounded rects -->
<!-- Cells are 60w x 80h, spaced 16px, starting at x=60 y=80 -->
<!-- Each cell: <rect x="..." y="..." width="60" height="80" rx="8" fill="url(#cellGrad)" stroke="var(--color-accent)" stroke-width="1.5"/> -->
<!-- Charge indicator bar inside each cell (height varies per cell: 0.7, 0.9, 0.6, 0.95, etc.) -->
<!-- Connecting lines between cells: thin horizontal/vertical lines in accent color at 40% opacity -->
<!-- Battery terminals at top: small rect protrusions on top of cells -->
<!-- BMS label: <text> centered at bottom "Battery Management System" in white at 12px -->
<!-- Floating stat card at bottom-left: white rounded rect with "98.5% Efficiency" label -->
<!-- Cyan glow effect: <circle cx="260" cy="200" r="120" fill="var(--color-accent)" fill-opacity="0.06"/> -->

Battery Cell Single (viewBox="0 0 160 240"):
<!-- Outer casing: rounded rect with metallic gradient -->
<!-- Terminals at top: two small rounded rects -->
<!-- Internal layers visible: anode/cathode simplified as horizontal bands -->
<!-- Charge level indicator: vertical fill bar with animated glow -->
<!-- Capacity label at bottom -->

Energy Flow Diagram (viewBox="0 0 480 200"):
<!-- Horizontal energy flow: Solar → BMS → Battery → Inverter → Grid -->
<!-- Each component: rounded rect with icon -->
<!-- Connecting arrows: bezier path with animated dasharray -->
<!-- Power numbers floating above arrows: "2.4kW", "48V" -->

EV Application Card Visual (viewBox="0 0 320 180"):
<!-- Car silhouette: simplified 3 curved shapes (body, roof, wheels) -->
<!-- Battery indicator: horizontal bar beneath car in cyan -->
<!-- Lightning bolt overlay on car body -->
<!-- "Range: 480km" floating label -->`,

  industrial: `
INDUSTRIAL / MANUFACTURING ILLUSTRATIONS:

Hero Visual (viewBox="0 0 520 400"):
<!-- Dark slate background panel -->
<!-- Factory building outline: simplified L-shaped building with chimney -->
<!-- Large gear: circle with 12 teeth, stroke only, primary color, centered right side -->
<!-- Small gear: interlocked with large gear, accent gold color -->
<!-- Gauge/dial: circle at top-right, tick marks 0-100, red needle at 94 -->
<!-- Stats overlay: "ISO 9001 Certified" badge + "25 Years Experience" card -->
<!-- Grid background: subtle 20px grid lines at 8% opacity -->

Precision Gear Assembly (viewBox="0 0 280 280"):
<!-- Three interlocking gears of different sizes -->
<!-- Gear teeth as individual rounded rectangles around circle perimeter -->
<!-- Stroke-only style: stroke="var(--color-primary)" stroke-width="2" fill="none" -->
<!-- Center circle with cross/axis indicator -->
<!-- Rotation animation via CSS: gear1 clockwise, gear2 counter-clockwise -->

Industrial Gauge (viewBox="0 0 200 200"):
<!-- Outer ring: thick circle arc from 225° to 495° (270° sweep) -->
<!-- Tick marks: 10 major ticks with numbers, 40 minor ticks -->
<!-- Color zones: green 0-80%, yellow 80-90%, red 90-100% -->
<!-- Needle: rotated line with circle pivot, pointing to current value -->
<!-- Center text: large value number + unit label -->

Production Specification Card (viewBox="0 0 380 220"):
<!-- Clean slate-bg card with dimensions arrows around a product silhouette -->
<!-- Horizontal arrows with bidirectional arrowheads and dimension labels -->
<!-- Specification table as SVG: columns for property and value -->`,

  ecommerce: `
E-COMMERCE / RETAIL ILLUSTRATIONS:

Hero Product Visual (viewBox="0 0 440 480"):
<!-- Tall portrait frame with rounded corners (product display proportions) -->
<!-- Gradient background: light-to-white vertical gradient as placeholder -->
<!-- Category color accent strip at top: primary color band 8px height -->
<!-- Center: stylized product shape silhouette appropriate to category -->
<!-- Price badge: right-aligned pill with accent color and discount % -->
<!-- "New Arrival" ribbon: diagonal strip at top-left corner -->
<!-- Trust signals: star rating row + "Free Shipping" tag at bottom -->

Product Card Grid Visual (viewBox="0 0 320 380"):
<!-- 4:3 image placeholder area at top: gradient from primary-light to white -->
<!-- Bottom half: product details area -->
<!-- Wishlist heart icon: top-right of image area -->
<!-- Category tag: pill at bottom of image area overlapping border -->
<!-- Animated hover effect: card lifts 8px with shadow increase -->

Shopping Bag Float Animation (viewBox="0 0 80 80"):
<!-- Rounded trapezoid bag body -->
<!-- Curved handle: arc above bag -->
<!-- Brand initial or heart on bag face -->
<!-- Subtle swing animation on page load -->`,

  saas: `
SAAS / SOFTWARE ILLUSTRATIONS:

Dashboard Mock-Up (viewBox="0 0 520 360"):
<!-- Browser chrome: rounded top with 3 control circles + URL bar -->
<!-- Sidebar: narrow left column with 6 nav items (rounded rects) -->
<!-- Main area: two stat cards at top (revenue + users) with colored numbers -->
<!-- Chart area: bar chart with 7 bars in varying primary shades + trend line -->
<!-- Table preview: 4 rows with alternating background -->
<!-- Glow effect: radial gradient glow on the highlighted stat card -->

Analytics Chart (viewBox="0 0 400 240"):
<!-- Y-axis: horizontal grid lines at 5 levels -->
<!-- X-axis: 12 month labels in small text -->
<!-- Area chart: smooth bezier path filled with primary color at 20% opacity -->
<!-- Line: 2px smooth bezier line in primary color on top of fill -->
<!-- Data points: 12 small circles at line vertices -->
<!-- Hover area: semi-transparent rect on current month with vertical dashed line -->
<!-- Trend annotation: "↑ 24% vs last period" badge -->

API Connection Visual (viewBox="0 0 400 200"):
<!-- Left box: "Your App" label in rounded rect -->
<!-- Right box: "Our API" label in rounded rect with primary gradient bg -->
<!-- Center connector: dashed bezier path with animated data packets (small squares moving along path) -->
<!-- Method labels: "GET /users", "POST /events" floating above/below connector -->

Feature Icon Grid (viewBox="0 0 320 320"):
<!-- 3x3 grid of app integration placeholder squares -->
<!-- Each square: rounded rect with single large letter/initial -->
<!-- Center hub: larger circle connected to all squares by thin lines -->`,

  healthcare: `
HEALTHCARE / WELLNESS ILLUSTRATIONS:

Hero Medical Visual (viewBox="0 0 480 380"):
<!-- Light background with large soft teal circle (r=180) at right, semi-transparent -->
<!-- Human figure outline: simplified body shape with heart highlight -->
<!-- ECG waveform: SVG path tracing a heartbeat across the composition -->
<!-- Floating stat cards: "500+ Patients", "98% Satisfaction" as white cards -->
<!-- Medical cross: + symbol in teal, 40px, in upper area -->

ECG / Heartbeat Line (viewBox="0 0 400 100"):
<!-- Horizontal baseline in muted color -->
<!-- Heartbeat SVG path: flat line → sharp spike up → deep trough → spike up → flat -->
<!-- Animated: CSS stroke-dasharray animation to draw the line left to right -->
<!-- Color: var(--color-primary) or bright red for heart monitor style -->

Wellness Circular Chart (viewBox="0 0 200 200"):
<!-- Concentric rings for different health metrics -->
<!-- Each ring: arc path with percentage fill in different teal shades -->
<!-- Center: percentage number and metric label -->
<!-- Small icons at ring ends: heart, lungs, brain -->

Doctor/Team Profile Frame (viewBox="0 0 160 180"):
<!-- Circle frame with subtle teal border -->
<!-- Abstract person silhouette (circle head + semicircle body) in teal -->
<!-- Stethoscope icon overlapping bottom of circle -->
<!-- Credential badge at bottom: "MD, Ph.D" in small pill -->`,

  food: `
FOOD / RESTAURANT ILLUSTRATIONS:

Hero Dish Visual (viewBox="0 0 440 440"):
<!-- Organic circular background blob: not a perfect circle, 8-point smooth star blob -->
<!-- Background: warm amber-orange gradient blob -->
<!-- Center: plate silhouette (circle) with food item hint (abstract warm shapes) -->
<!-- Fork and knife: flanking the plate in elegant outline style -->
<!-- Steam waves: 3 wavy vertical paths above the plate in white at 60% opacity -->
<!-- Rating badge: 5 gold star SVGs in a row below plate -->
<!-- Price tag: rounded rect at bottom-right with warm color -->

Menu Item Card Visual (viewBox="0 0 360 240"):
<!-- Warm oval/rounded rect frame for dish image area -->
<!-- Gradient fill: amber to orange warm gradient as placeholder -->
<!-- Dish category tag pill at top of frame -->
<!-- Dietary icons row: leaf (vegan), flame (spicy), wheat (gluten) etc. as simple path SVGs -->

Restaurant Interior Illustration (viewBox="0 0 480 300"):
<!-- Simplified interior: table shapes (ellipses), chairs (semicircles), window with curtains (arcs) -->
<!-- Warm lighting glow: radial gradients in amber at lamp positions -->
<!-- Plant silhouettes in corners: simple leaf clusters -->
<!-- Ambiance lines: subtle diagonal soft stripes at 5% opacity -->`,

  realestate: `
REAL ESTATE / PROPERTY ILLUSTRATIONS:

Hero Property Visual (viewBox="0 0 520 380"):
<!-- Property silhouette: simple house outline (pentagon roof + rectangle body + door + two windows) -->
<!-- Surrounding: garden/landscape curves (soft green path) and tree silhouettes -->
<!-- Map pin: large teardrop shape with house icon inside -->
<!-- Floating details card: "3 Beds · 2 Baths · 220 m²" in white card -->
<!-- Sold/Available badge: colored pill at upper corner -->
<!-- Green foliage accents: leaf/tree shapes in lower corners -->

Floor Plan Visual (viewBox="0 0 400 320"):
<!-- Blueprint-style: thin 1px lines on slightly tinted background -->
<!-- Room outlines: rectangles representing living room, bedrooms, kitchen, bathrooms -->
<!-- Door arcs: quarter-circle arcs at door openings -->
<!-- Dimension arrows: bidirectional arrows with meter labels -->
<!-- Room labels: small text centered in each room -->
<!-- North compass rose at top-right -->

Property Metrics Card (viewBox="0 0 320 180"):
<!-- Dark green header bar with property address -->
<!-- Three columns: sqm, beds, baths with icon and number -->
<!-- Price row at bottom with accent gold color -->
<!-- Heart/save icon at top-right -->`,

  finance: `
FINANCE / FINTECH ILLUSTRATIONS:

Hero Financial Visual (viewBox="0 0 520 380"):
<!-- Dark slate background panel with subtle grid overlay -->
<!-- Rising line chart: smooth upward bezier in emerald green on dark bg -->
<!-- Area fill: emerald with 15% opacity below the line -->
<!-- Data points: 8 circles with pulse animation on last point -->
<!-- Floating metric cards: "$2.4M Total Value", "+18.3% Annual Return" -->
<!-- Security badge: shield icon with lock, bottom-left corner -->
<!-- Subtle grid: 20px horizontal lines at 8% opacity on dark bg -->

Portfolio Donut Chart (viewBox="0 0 240 240"):
<!-- Donut chart: 4 arc segments with different emerald/slate shades -->
<!-- Center: total value in large text -->
<!-- Legend: colored squares with allocation percentages at right -->
<!-- Hover segment: slight scale-up + glow effect on focus -->

Growth Trend Bar Chart (viewBox="0 0 400 260"):
<!-- Monthly bars: 12 bars in varying emerald shades -->
<!-- Trend line: smooth bezier overlay on bars in accent color -->
<!-- Y-axis value labels: formatted currency amounts -->
<!-- X-axis month abbreviations -->
<!-- Performance annotation: "Peak Month: +32%" with arrow -->`,

  education: `
EDUCATION / LEARNING ILLUSTRATIONS:

Hero Learning Visual (viewBox="0 0 480 380"):
<!-- Graduation cap: 3D isometric mortarboard with diploma scroll -->
<!-- Open book: splayed pages with text lines hinted as horizontal stripes -->
<!-- Floating course cards: "12 Lessons", "4.9 Rating", "Certificate" -->
<!-- Progress arc: 73% completion ring in primary blue around the cap -->
<!-- Floating student avatar cluster: 5 overlapping circles in a row (social proof) -->

Course Card Thumbnail (viewBox="0 0 400 225"):
<!-- Category-colored gradient background (each category has a distinct shade of primary) -->
<!-- Center: play button circle (large, white, 60px radius) -->
<!-- Category label tag at top-left -->
<!-- Duration badge at bottom-right: "2h 30m" with clock icon -->
<!-- Instructor avatar: small circle at bottom-left -->

Progress Ring (viewBox="0 0 120 120"):
<!-- Outer ring: full circle in border color, 8px stroke width -->
<!-- Progress arc: colored arc from top, stroke-dasharray based on percentage -->
<!-- Center: large percentage number in primary color -->
<!-- Ring end cap: small colored circle at progress end -->`,

  default: `
GENERAL PURPOSE ILLUSTRATIONS:

Hero Feature Visual (viewBox="0 0 480 360"):
<!-- Primary gradient background panel (primary to primary-dark) -->
<!-- Abstract floating card stack: 3 stacked rounded rects, slightly offset and rotated -->
<!-- Top card: has icon + title + short stat number -->
<!-- Glow: large radial gradient in accent color at 20% opacity behind cards -->
<!-- Floating badge: circular achievement/checkmark badge -->
<!-- Background: subtle dot grid at 6% opacity -->

Feature Icon Container (viewBox="0 0 80 80"):
<!-- Outer: rounded square (rx=20) in primary-light -->
<!-- Inner: centered 40px icon path in primary color -->
<!-- Optional: accent dot in corner for visual interest -->
<!-- Hover state: background shifts to primary, icon to white -->

Stats Display Card (viewBox="0 0 300 160"):
<!-- White card with strong shadow -->
<!-- Large metric number centered: primary color, bold -->
<!-- Metric label below: muted text -->
<!-- Trend indicator: small arrow + percentage in green or red -->
<!-- Icon at top-left: relevant category icon -->`,
};

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildIllustrationRules(idea: string): string {
  const industry = detectIndustry(idea);
  const template = ILLUSTRATION_TEMPLATES[industry];

  return `
SVG ILLUSTRATION SYSTEM

${SVG_BASE_RULES}

CSS COMPOSITION PATTERNS (no SVG needed — pure CSS visuals):

Pattern 1 — Gradient Blob Hero Visual:
  .hero__visual {
    position: relative;
    border-radius: 24px;
    overflow: hidden;
    background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
    padding: 40px;
  }
  .hero__visual::before {
    content: '';
    position: absolute;
    width: 300px; height: 300px;
    border-radius: 50%;
    background: var(--color-accent);
    opacity: 0.12;
    top: -80px; right: -80px;
  }

Pattern 2 — Circuit/Grid Background:
  .section--tech {
    background-image:
      linear-gradient(var(--color-border) 1px, transparent 1px),
      linear-gradient(90deg, var(--color-border) 1px, transparent 1px);
    background-size: 24px 24px;
    background-color: var(--color-bg-secondary);
  }

Pattern 3 — Floating Stat Card:
  .hero__stat-card {
    position: absolute;
    background: white;
    border-radius: 12px;
    padding: 14px 20px;
    box-shadow: var(--shadow-xl);
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--color-text-primary);
    white-space: nowrap;
    z-index: 10;
  }

INDUSTRY-SPECIFIC SVG TEMPLATES:
${template}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface IllustrationInput { idea: string }
export interface IllustrationOutput { industry: IndustryCategory; rules: string }

export class IllustrationSkill extends BaseSkill<IllustrationInput, IllustrationOutput> {
  readonly name = "visual/illustration";
  readonly description = "Industry-specific SVG illustration patterns and CSS composition rules";
  readonly version = "1.0.0";

  async execute(
    input: IllustrationInput,
    _ctx: GenerationContext,
  ): Promise<SkillResult<IllustrationOutput>> {
    const start = Date.now();
    this.logs = [];
    const industry = detectIndustry(input.idea);
    this.log(`Illustration templates: ${industry}`);
    return this.buildResult(true, {
      industry,
      rules: buildIllustrationRules(input.idea),
    }, start);
  }
}

export const illustrationSkill = new IllustrationSkill();
