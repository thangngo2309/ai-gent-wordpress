/**
 * Color Harmony Skill.
 *
 * Detects the project industry from the idea string and returns a harmonious,
 * premium color palette for that sector.  The palette overrides the generic
 * defaults from design-system.skill.ts so every generated theme feels
 * tailored to its market rather than looking like a generic SaaS template.
 *
 * Industry categories and their rationale:
 *  - energy / battery / EV   : deep navy + electric cyan (technological authority)
 *  - industrial / manufacturing: slate + amber/gold (serious, established)
 *  - ecommerce / fashion      : near-black + warm orange (modern retail)
 *  - saas / software / ai     : indigo/violet + cyan (innovation)
 *  - healthcare / wellness    : teal + blue (trust, calm)
 *  - food / restaurant        : warm brown + orange (appetite, warmth)
 *  - real-estate / property   : forest green + gold (stability, prestige)
 *  - finance / fintech        : deep slate + emerald (trust, growth)
 *  - education                : blue + orange (energy, clarity)
 *  - default                  : sky blue + amber (universal)
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  INDUSTRY DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export type IndustryCategory =
  | "energy"
  | "industrial"
  | "ecommerce"
  | "saas"
  | "healthcare"
  | "food"
  | "realestate"
  | "finance"
  | "education"
  | "default";

const INDUSTRY_KEYWORDS: Record<IndustryCategory, RegExp> = {
  energy:      /\b(battery|lithium|li-ion|lifepo|ev\b|electric.?vehicle|solar|wind|renewable|energy storage|power.?pack|charging|grid|inverter|bms|accumulator|ắc.?quy|pin.?lithium|năng.?lượng|điện)\b/i,
  industrial:  /\b(factory|manufacturing|industrial|machinery|equipment|production|steel|metal|cnc|automation|welding|forging|casting|warehouse)\b/i,
  ecommerce:   /\b(shop|store|fashion|clothing|apparel|beauty|accessories|boutique|marketplace|woocommerce|cart|checkout|buy|sell|product catalog|thời.?trang|cửa.?hàng)\b/i,
  saas:        /\b(saas|software|app\b|platform|dashboard|analytics|api|cloud|startup|ai\b|machine.?learning|devtools|crm|erp|workflow|automation tool)\b/i,
  healthcare:  /\b(health|medical|clinic|wellness|pharma|dental|hospital|therapy|fitness|nutrition|doctor|patient|telemedicine)\b/i,
  food:        /\b(restaurant|cafe|food|bakery|catering|kitchen|coffee|bar\b|bistro|cuisine|delivery.?food|meal|dining|ăn.?uống|nhà.?hàng)\b/i,
  realestate:  /\b(real.?estate|property|homes|apartment|rent|lease|realtor|housing|condo|villa|construction|architect|bất.?động.?sản)\b/i,
  finance:     /\b(finance|bank|investment|trading|crypto|fintech|insurance|lending|mortgage|wealth|asset|fund|stock)\b/i,
  education:   /\b(education|school|course|learn|training|university|e-?learning|tutoring|certification|bootcamp|academy|giáo.?dục|khóa.?học)\b/i,
  default:     /.*/,
};

export function detectIndustry(idea: string): IndustryCategory {
  const text = idea.toLowerCase();
  for (const [industry, pattern] of Object.entries(INDUSTRY_KEYWORDS) as [IndustryCategory, RegExp][]) {
    if (industry !== "default" && pattern.test(text)) return industry;
  }
  return "default";
}

// ─────────────────────────────────────────────────────────────────────────────
//  PALETTES
// ─────────────────────────────────────────────────────────────────────────────

export interface IndustryPalette {
  label: string;
  description: string;
  colors: Record<string, string>;
  /** Google Fonts to load — heading + body */
  fonts: { heading: string; body: string; googleUrl: string };
  /** Dark section background (used for hero/CTA dark variant) */
  darkBg: string;
  darkText: string;
}

export const INDUSTRY_PALETTES: Record<IndustryCategory, IndustryPalette> = {
  energy: {
    label: "Energy & Battery Technology",
    description: "Deep navy authority + electric cyan energy — conveys technological precision and power",
    fonts: {
      heading: "'Sora', 'Inter', system-ui, sans-serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#0d1b2a",
    darkText:  "#e2f0ff",
    colors: {
      "--color-primary":        "#1d6fa4",
      "--color-primary-dark":   "#155e8a",
      "--color-primary-light":  "#dbeafe",
      "--color-accent":         "#06b6d4",
      "--color-accent-dark":    "#0891b2",
      "--color-text-primary":   "#0d1b2a",
      "--color-text-secondary": "#334f6b",
      "--color-text-muted":     "#7a9ab8",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#f0f6ff",
      "--color-bg-tertiary":    "#e1eeff",
      "--color-border":         "#bdd6f0",
      "--color-border-strong":  "#93c0e0",
      "--color-success":        "#059669",
      "--color-error":          "#dc2626",
    },
  },

  industrial: {
    label: "Industrial & Manufacturing",
    description: "Authoritative slate + gold accent — serious, established, precision-engineered",
    fonts: {
      heading: "'Barlow', 'Inter', system-ui, sans-serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Barlow:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#1e293b",
    darkText:  "#f1f5f9",
    colors: {
      "--color-primary":        "#1e3a5f",
      "--color-primary-dark":   "#0f2035",
      "--color-primary-light":  "#dde8f5",
      "--color-accent":         "#d97706",
      "--color-accent-dark":    "#b45309",
      "--color-text-primary":   "#0f172a",
      "--color-text-secondary": "#475569",
      "--color-text-muted":     "#94a3b8",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#f8fafc",
      "--color-bg-tertiary":    "#f1f5f9",
      "--color-border":         "#e2e8f0",
      "--color-border-strong":  "#cbd5e1",
      "--color-success":        "#059669",
      "--color-error":          "#dc2626",
    },
  },

  ecommerce: {
    label: "E-commerce & Retail",
    description: "Near-black editorial + warm orange — modern retail confidence and energy",
    fonts: {
      heading: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#18181b",
    darkText:  "#fafafa",
    colors: {
      "--color-primary":        "#18181b",
      "--color-primary-dark":   "#09090b",
      "--color-primary-light":  "#f4f4f5",
      "--color-accent":         "#f97316",
      "--color-accent-dark":    "#ea580c",
      "--color-text-primary":   "#09090b",
      "--color-text-secondary": "#52525b",
      "--color-text-muted":     "#a1a1aa",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#fafafa",
      "--color-bg-tertiary":    "#f4f4f5",
      "--color-border":         "#e4e4e7",
      "--color-border-strong":  "#d4d4d8",
      "--color-success":        "#16a34a",
      "--color-error":          "#dc2626",
    },
  },

  saas: {
    label: "SaaS & Software",
    description: "Confident indigo + electric cyan — innovation, modernity, developer trust",
    fonts: {
      heading: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#1e1b4b",
    darkText:  "#eef2ff",
    colors: {
      "--color-primary":        "#4f46e5",
      "--color-primary-dark":   "#3730a3",
      "--color-primary-light":  "#eef2ff",
      "--color-accent":         "#06b6d4",
      "--color-accent-dark":    "#0891b2",
      "--color-text-primary":   "#0f172a",
      "--color-text-secondary": "#475569",
      "--color-text-muted":     "#94a3b8",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#f8fafc",
      "--color-bg-tertiary":    "#f1f5f9",
      "--color-border":         "#e2e8f0",
      "--color-border-strong":  "#c7d2fe",
      "--color-success":        "#059669",
      "--color-error":          "#dc2626",
    },
  },

  healthcare: {
    label: "Healthcare & Wellness",
    description: "Trust-inspiring teal + calm blue — competence, care, reliability",
    fonts: {
      heading: "'DM Sans', 'Inter', system-ui, sans-serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#0d4a42",
    darkText:  "#f0fdfa",
    colors: {
      "--color-primary":        "#0d9488",
      "--color-primary-dark":   "#0f766e",
      "--color-primary-light":  "#ccfbf1",
      "--color-accent":         "#3b82f6",
      "--color-accent-dark":    "#2563eb",
      "--color-text-primary":   "#0f172a",
      "--color-text-secondary": "#475569",
      "--color-text-muted":     "#94a3b8",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#f0fdfa",
      "--color-bg-tertiary":    "#ccfbf1",
      "--color-border":         "#99f6e4",
      "--color-border-strong":  "#5eead4",
      "--color-success":        "#059669",
      "--color-error":          "#dc2626",
    },
  },

  food: {
    label: "Food & Restaurant",
    description: "Warm amber-brown + rich orange — appetite, warmth, craft",
    fonts: {
      heading: "'Playfair Display', 'Georgia', serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#1c0a00",
    darkText:  "#fef3c7",
    colors: {
      "--color-primary":        "#92400e",
      "--color-primary-dark":   "#78350f",
      "--color-primary-light":  "#fef3c7",
      "--color-accent":         "#f97316",
      "--color-accent-dark":    "#ea580c",
      "--color-text-primary":   "#1c0a00",
      "--color-text-secondary": "#78350f",
      "--color-text-muted":     "#a16207",
      "--color-bg-primary":     "#fffbf5",
      "--color-bg-secondary":   "#fef9ee",
      "--color-bg-tertiary":    "#fef3c7",
      "--color-border":         "#fde68a",
      "--color-border-strong":  "#fcd34d",
      "--color-success":        "#16a34a",
      "--color-error":          "#dc2626",
    },
  },

  realestate: {
    label: "Real Estate & Property",
    description: "Forest green + gold — stability, prestige, natural wealth",
    fonts: {
      heading: "'Cormorant Garamond', 'Georgia', serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#052e16",
    darkText:  "#f0fdf4",
    colors: {
      "--color-primary":        "#15803d",
      "--color-primary-dark":   "#166534",
      "--color-primary-light":  "#dcfce7",
      "--color-accent":         "#d97706",
      "--color-accent-dark":    "#b45309",
      "--color-text-primary":   "#052e16",
      "--color-text-secondary": "#166534",
      "--color-text-muted":     "#4ade80",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#f0fdf4",
      "--color-bg-tertiary":    "#dcfce7",
      "--color-border":         "#bbf7d0",
      "--color-border-strong":  "#86efac",
      "--color-success":        "#16a34a",
      "--color-error":          "#dc2626",
    },
  },

  finance: {
    label: "Finance & Fintech",
    description: "Deep slate + emerald — authority, trust, growth",
    fonts: {
      heading: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#020617",
    darkText:  "#f8fafc",
    colors: {
      "--color-primary":        "#0f172a",
      "--color-primary-dark":   "#020617",
      "--color-primary-light":  "#e2e8f0",
      "--color-accent":         "#059669",
      "--color-accent-dark":    "#047857",
      "--color-text-primary":   "#0f172a",
      "--color-text-secondary": "#475569",
      "--color-text-muted":     "#94a3b8",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#f8fafc",
      "--color-bg-tertiary":    "#f1f5f9",
      "--color-border":         "#e2e8f0",
      "--color-border-strong":  "#cbd5e1",
      "--color-success":        "#059669",
      "--color-error":          "#dc2626",
    },
  },

  education: {
    label: "Education & Learning",
    description: "Confident blue + vibrant orange — knowledge, energy, clarity",
    fonts: {
      heading: "'Nunito', 'Inter', system-ui, sans-serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#1e3a8a",
    darkText:  "#eff6ff",
    colors: {
      "--color-primary":        "#2563eb",
      "--color-primary-dark":   "#1d4ed8",
      "--color-primary-light":  "#dbeafe",
      "--color-accent":         "#f97316",
      "--color-accent-dark":    "#ea580c",
      "--color-text-primary":   "#0f172a",
      "--color-text-secondary": "#475569",
      "--color-text-muted":     "#94a3b8",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#eff6ff",
      "--color-bg-tertiary":    "#dbeafe",
      "--color-border":         "#bfdbfe",
      "--color-border-strong":  "#93c5fd",
      "--color-success":        "#16a34a",
      "--color-error":          "#dc2626",
    },
  },

  default: {
    label: "General / Multi-purpose",
    description: "Sky blue + warm amber — universal, clean, professional",
    fonts: {
      heading: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
      body:    "'Inter', system-ui, sans-serif",
      googleUrl: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    },
    darkBg:   "#0f172a",
    darkText:  "#f8fafc",
    colors: {
      "--color-primary":        "#0ea5e9",
      "--color-primary-dark":   "#0284c7",
      "--color-primary-light":  "#e0f2fe",
      "--color-accent":         "#f59e0b",
      "--color-accent-dark":    "#d97706",
      "--color-text-primary":   "#0f172a",
      "--color-text-secondary": "#475569",
      "--color-text-muted":     "#94a3b8",
      "--color-bg-primary":     "#ffffff",
      "--color-bg-secondary":   "#f8fafc",
      "--color-bg-tertiary":    "#f1f5f9",
      "--color-border":         "#e2e8f0",
      "--color-border-strong":  "#cbd5e1",
      "--color-success":        "#10b981",
      "--color-error":          "#ef4444",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildColorHarmonyRules(idea: string): string {
  const industry = detectIndustry(idea);
  const palette = INDUSTRY_PALETTES[industry];

  const colorList = Object.entries(palette.colors)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  return `
COLOR HARMONY SYSTEM — ${palette.label.toUpperCase()}

This website is classified as: ${palette.label}
Palette rationale: ${palette.description}

MANDATORY :root COLOR TOKENS (use EXACTLY these values):
${colorList}

TYPOGRAPHY FONTS:
- Heading font-family: ${palette.fonts.heading}
- Body font-family:    ${palette.fonts.body}
- Google Fonts URL:    ${palette.fonts.googleUrl}
  (enqueue via wp_enqueue_style with a preconnect hint, NOT via @import in style.css)

DARK SECTION COLORS (for hero, CTA, dark-mode sections):
- Dark background: ${palette.darkBg}
- Dark text: ${palette.darkText}

COLOR USAGE RULES:
- var(--color-primary): main CTAs, links, active states, icon fills, section accents.
- var(--color-primary-dark): hover state on primary buttons.
- var(--color-primary-light): tinted section backgrounds, icon containers, tag pills.
- var(--color-accent): secondary highlights, badges, star ratings, sale prices.
- var(--color-bg-secondary): alternating section backgrounds (every other section).
- NEVER use more than 3 distinct color hues on a single page.
- NEVER use saturated gradients with >2 stops; subtle 2-stop gradients only.
- NEVER use neon or fluorescent colors.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface ColorHarmonyInput { idea: string }
export interface ColorHarmonyOutput {
  industry: IndustryCategory;
  palette: IndustryPalette;
  rules: string;
  cssVarOverrides: Record<string, string>;
  googleFontsUrl: string;
}

export class ColorHarmonySkill extends BaseSkill<ColorHarmonyInput, ColorHarmonyOutput> {
  readonly name = "visual/color-harmony";
  readonly description = "Industry-aware color palette selection for harmonious, premium theme generation";
  readonly version = "1.0.0";

  async execute(
    input: ColorHarmonyInput,
    _ctx: GenerationContext,
  ): Promise<SkillResult<ColorHarmonyOutput>> {
    const start = Date.now();
    this.logs = [];

    const industry = detectIndustry(input.idea);
    const palette = INDUSTRY_PALETTES[industry];
    const rules = buildColorHarmonyRules(input.idea);

    this.log(`Industry detected: ${industry} (${palette.label})`);

    return this.buildResult(true, {
      industry,
      palette,
      rules,
      cssVarOverrides: palette.colors,
      googleFontsUrl: palette.fonts.googleUrl,
    }, start);
  }
}

export const colorHarmonySkill = new ColorHarmonySkill();
