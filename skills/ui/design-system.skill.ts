/**
 * Design System Skill.
 *
 * Provides the canonical design token set for premium WordPress themes:
 * typography scale, spacing scale, color palette, border radius, shadows,
 * container widths, and grid system.
 *
 * The buildDesignSystemCssVars() helper is consumed by buildThemeBatchPrompt
 * to seed the style.css generation with correct :root defaults.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import {
  detectIndustry,
  INDUSTRY_PALETTES,
} from "../../skills/visual/color-harmony.skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignTokens {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  typography: {
    fontFamilyHeading: string;
    fontFamilyBody: string;
  };
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  containers: Record<string, string>;
  transitions: Record<string, string>;
}

export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  colors: {
    "--color-primary":         "#0ea5e9",
    "--color-primary-dark":    "#0284c7",
    "--color-primary-light":   "#e0f2fe",
    "--color-accent":          "#f59e0b",
    "--color-accent-dark":     "#d97706",
    "--color-text-primary":    "#0f172a",
    "--color-text-secondary":  "#475569",
    "--color-text-muted":      "#94a3b8",
    "--color-bg-primary":      "#ffffff",
    "--color-bg-secondary":    "#f8fafc",
    "--color-bg-tertiary":     "#f1f5f9",
    "--color-border":          "#e2e8f0",
    "--color-border-strong":   "#cbd5e1",
    "--color-success":         "#10b981",
    "--color-error":           "#ef4444",
  },
  spacing: {
    "--space-1":          "0.25rem",
    "--space-2":          "0.5rem",
    "--space-3":          "0.75rem",
    "--space-4":          "1rem",
    "--space-5":          "1.25rem",
    "--space-6":          "1.5rem",
    "--space-8":          "2rem",
    "--space-10":         "2.5rem",
    "--space-12":         "3rem",
    "--space-16":         "4rem",
    "--space-20":         "5rem",
    "--space-24":         "6rem",
    "--space-section":    "5rem",
    "--space-section-lg": "7.5rem",
  },
  typography: {
    fontFamilyHeading: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
    fontFamilyBody:    "'Inter', system-ui, sans-serif",
  },
  borderRadius: {
    "--radius-sm":   "0.375rem",
    "--radius-md":   "0.75rem",
    "--radius-lg":   "1rem",
    "--radius-xl":   "1.5rem",
    "--radius-2xl":  "2rem",
    "--radius-full": "9999px",
  },
  shadows: {
    "--shadow-sm":        "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    "--shadow-md":        "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
    "--shadow-lg":        "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)",
    "--shadow-xl":        "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.06)",
    "--shadow-card":      "0 1px 3px rgb(0 0 0 / 0.06), 0 4px 16px rgb(0 0 0 / 0.06)",
    "--shadow-card-hover":"0 8px 24px rgb(0 0 0 / 0.12)",
  },
  containers: {
    "--container-sm":      "640px",
    "--container-md":      "768px",
    "--container-lg":      "1024px",
    "--container-xl":      "1280px",
    "--container-content": "720px",
  },
  transitions: {
    "--transition-fast":   "150ms ease",
    "--transition-normal": "250ms ease",
    "--transition-slow":   "400ms ease",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  INDUSTRY-AWARE TOKEN BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build design tokens tailored to the detected industry.
 * Merges the industry color palette over the DEFAULT_DESIGN_TOKENS,
 * and updates font stacks to match the industry's typography choice.
 */
export function buildIndustryAwareTokens(idea: string): DesignTokens {
  const industry = detectIndustry(idea);
  const palette = INDUSTRY_PALETTES[industry];

  return {
    ...DEFAULT_DESIGN_TOKENS,
    colors: { ...DEFAULT_DESIGN_TOKENS.colors, ...palette.colors },
    typography: {
      fontFamilyHeading: palette.fonts.heading,
      fontFamilyBody:    palette.fonts.body,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  CSS VAR BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the :root CSS variables block from design tokens.
 * Injected into the theme generation prompt as the canonical token set.
 */
export function buildDesignSystemCssVars(tokens: DesignTokens = DEFAULT_DESIGN_TOKENS): string {
  const lines: string[] = [":root {"];

  const groups: Array<{ label: string; map: Record<string, string> }> = [
    { label: "/* — Color System — */", map: tokens.colors },
    { label: "/* — Spacing Scale — */", map: tokens.spacing },
    { label: "/* — Border Radius — */", map: tokens.borderRadius },
    { label: "/* — Shadows — */", map: tokens.shadows },
    { label: "/* — Containers — */", map: tokens.containers },
    { label: "/* — Transitions — */", map: tokens.transitions },
  ];

  for (const group of groups) {
    lines.push(`  ${group.label}`);
    for (const [prop, val] of Object.entries(group.map)) {
      lines.push(`  ${prop}: ${val};`);
    }
    lines.push("");
  }

  lines.push("  /* — Typography — */");
  lines.push(`  --font-heading: ${tokens.typography.fontFamilyHeading};`);
  lines.push(`  --font-body: ${tokens.typography.fontFamilyBody};`);
  lines.push("  --text-xs:   0.75rem;");
  lines.push("  --text-sm:   0.875rem;");
  lines.push("  --text-base: 1rem;");
  lines.push("  --text-lg:   1.125rem;");
  lines.push("  --text-xl:   1.25rem;");
  lines.push("  --text-2xl:  1.5rem;");
  lines.push("  --text-3xl:  1.875rem;");
  lines.push("  --text-4xl:  2.25rem;");
  lines.push("  --text-5xl:  3rem;");
  lines.push("  --text-6xl:  3.75rem;");
  lines.push("}");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignSystemOutput {
  cssVars: string;
  tokens: DesignTokens;
}

export class DesignSystemSkill extends BaseSkill<{ idea?: string } | undefined, DesignSystemOutput> {
  readonly name = "ui/design-system";
  readonly description = "Canonical design tokens and CSS custom properties for premium theme generation";
  readonly version = "1.0.0";

  async execute(
    input: { idea?: string } | undefined,
    _ctx: GenerationContext,
  ): Promise<SkillResult<DesignSystemOutput>> {
    const start = Date.now();
    this.logs = [];

    const tokens = input?.idea
      ? buildIndustryAwareTokens(input.idea)
      : DEFAULT_DESIGN_TOKENS;

    const cssVars = buildDesignSystemCssVars(tokens);
    this.log(input?.idea
      ? `Industry-aware design tokens generated for idea: "${input.idea.slice(0, 60)}"`
      : "Default design system tokens generated");

    return this.buildResult(true, { cssVars, tokens }, start);
  }
}

export const designSystemSkill = new DesignSystemSkill();
