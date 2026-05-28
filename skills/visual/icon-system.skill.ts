/**
 * Icon System Skill.
 *
 * Enforces a single, consistent Lucide-compatible SVG icon system
 * across all generated WordPress themes.
 *
 * All icons follow the same visual grammar:
 * - 24×24 viewBox (Lucide standard)
 * - 2px stroke width
 * - stroke-linecap="round"
 * - stroke-linejoin="round"
 * - No fill (stroke only)
 * - Color via currentColor or CSS variable inheritance
 *
 * Provides ready-to-use SVG path data for the most common UI icons
 * so the LLM doesn't need to improvise path shapes.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  ICON LIBRARY (Lucide-compatible paths)
// ─────────────────────────────────────────────────────────────────────────────

export const ICON_PATHS: Record<string, string> = {
  // Navigation & Actions
  "arrow-right":       `<polyline points="9 18 15 12 9 6"/>`,
  "arrow-left":        `<polyline points="15 18 9 12 15 6"/>`,
  "chevron-right":     `<polyline points="9 18 15 12 9 6"/>`,
  "chevron-down":      `<polyline points="6 9 12 15 18 9"/>`,
  "external-link":     `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`,
  "menu":              `<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>`,
  "x":                 `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  "search":            `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  "plus":              `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,

  // Status & Feedback
  "check":             `<polyline points="20 6 9 17 4 12"/>`,
  "check-circle":      `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
  "check-circle-2":    `<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>`,
  "x-circle":          `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
  "alert-circle":      `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
  "info":              `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
  "star":              `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,

  // Communication
  "mail":              `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>`,
  "phone":             `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.64 13 19.79 19.79 0 0 1 1.08 4.34 2 2 0 0 1 3.05 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/>`,
  "message-circle":    `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,

  // Business & Commerce
  "shopping-cart":     `<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>`,
  "shopping-bag":      `<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>`,
  "package":           `<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>`,
  "tag":               `<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`,
  "credit-card":       `<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  "truck":             `<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`,

  // Energy & Technology
  "zap":               `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  "battery":           `<rect x="1" y="6" width="18" height="12" rx="2" ry="2"/><line x1="23" y1="13" x2="23" y2="11"/><line x1="5" y1="12" x2="9" y2="12"/>`,
  "battery-charging":  `<path d="M5 18H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.19M15 6h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3.19"/><line x1="23" y1="13" x2="23" y2="11"/><polyline points="11 6 7 12 13 12 9 18"/>`,
  "cpu":               `<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>`,
  "sun":               `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`,
  "activity":          `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
  "wifi":              `<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>`,

  // Settings & Security
  "settings":          `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  "shield":            `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  "lock":              `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  "key":               `<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>`,

  // People & Social
  "user":              `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  "users":             `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  "heart":             `<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>`,
  "thumbs-up":         `<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>`,
  "quote":             `<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>`,

  // Location & Navigation
  "map-pin":           `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
  "globe":             `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  "home":              `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,

  // Content & Media
  "play-circle":       `<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>`,
  "image":             `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`,
  "file-text":         `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>`,
  "bar-chart-2":       `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
  "trending-up":       `<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>`,

  // Misc Utilities
  "clock":             `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  "calendar":          `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  "award":             `<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>`,
  "leaf":              `<path d="M2 22s4.3-12.5 18.5-16.5C20.5 5.5 20 6.5 18 10c-2 3.5-6 6-10.5 7.5"/><path d="M2 22c2-4 4-8 6-10"/>`,
  "layers":            `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`,
  "grid":              `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`,
};

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a complete inline SVG icon element.
 */
export function iconSvg(
  name: string,
  options: { size?: number; color?: string; className?: string; ariaHidden?: boolean } = {},
): string {
  const path = ICON_PATHS[name];
  if (!path) return `<!-- icon "${name}" not found -->`;

  const { size = 24, color = "currentColor", className = "", ariaHidden = true } = options;
  const ariaAttr = ariaHidden ? ' aria-hidden="true"' : "";
  const classAttr = className ? ` class="${className}"` : "";

  return `<svg${classAttr} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${ariaAttr}>${path}</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  RULES BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildIconSystemRules(): string {
  const popularIcons = Object.keys(ICON_PATHS).slice(0, 30).join(", ");

  return `
ICON SYSTEM — LUCIDE-COMPATIBLE SVG ICONS

MANDATORY ICON STANDARD:
- All icons: inline SVG with viewBox="0 0 24 24"
- stroke-width="2" on ALL icons (never 1, never 3)
- stroke-linecap="round" stroke-linejoin="round" on ALL icons
- fill="none" on ALL icons (stroke-only, no solid fills)
- stroke="currentColor" so icons inherit text color from parent
- aria-hidden="true" on decorative icons; aria-label on interactive icons

ICON SIZING SYSTEM:
- Micro:  16×16 — inside buttons, small badge labels
- Small:  20×20 — form field icons, nav items, tags
- Base:   24×24 — default body usage, list items, card icons
- Medium: 32×32 — feature section icon containers
- Large:  48×48 — hero section icon highlights
- Hero:   64×64 — standalone section intro icons
- Never use odd sizes (17px, 22px, etc.) — stick to the scale above.

ICON CONTAINER PATTERN (for feature sections):
  <div class="icon-container">
    <!-- SVG icon here, 32×32, stroke="var(--color-primary)" -->
  </div>
  .icon-container {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: var(--color-primary-light);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

AVAILABLE ICONS (use these — do NOT invent new paths):
  ${popularIcons}
  ... (and more — full list covers arrows, check/x marks, shopping, energy, settings, social, location, content)

ICON USAGE BY SECTION TYPE:
- Navigation: menu, x, search, external-link, chevron-down
- Feature benefits: check-circle-2, zap, shield, layers, grid, award, star
- Contact/CTA: mail, phone, map-pin, arrow-right, message-circle
- Products: package, shopping-cart, tag, truck, credit-card
- Technology: cpu, activity, wifi, settings, trending-up, bar-chart-2
- Energy: battery, battery-charging, zap, sun, activity
- Team/People: user, users, heart, quote, thumbs-up
- Time/Process: clock, calendar, check, layers

ICON COLOR RULES:
- Feature icons in .icon-container: stroke="var(--color-primary)"
- Checkmark icons in benefit lists: stroke="var(--color-success)" (#059669 green)
- Warning/error: stroke="#dc2626"
- Navigation icons: stroke="currentColor" (inherits link color)
- Dark sections: stroke="white" or stroke="var(--color-primary-light)"

FORBIDDEN ICON PRACTICES:
- ✗ Emoji characters as icons (👍 🔋 ⚡) — use SVG paths
- ✗ Font icon libraries (Font Awesome, Material Icons CDN) — inline SVG only
- ✗ Raster image icons (PNG, JPG) — inline SVG only
- ✗ Mixing icon styles (some outline + some filled) — all outline
- ✗ Inconsistent sizes on same-level items
- ✗ Very thick strokes (stroke-width="4") on 24px icons — too heavy`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface IconSystemOutput { rules: string; iconCount: number }

export class IconSystemSkill extends BaseSkill<undefined, IconSystemOutput> {
  readonly name = "visual/icon-system";
  readonly description = "Consistent Lucide-compatible SVG icon system for WordPress themes";
  readonly version = "1.0.0";

  async execute(
    _input: undefined,
    _ctx: GenerationContext,
  ): Promise<SkillResult<IconSystemOutput>> {
    const start = Date.now();
    this.logs = [];
    this.log(`Icon library loaded: ${Object.keys(ICON_PATHS).length} icons`);
    return this.buildResult(true, {
      rules: buildIconSystemRules(),
      iconCount: Object.keys(ICON_PATHS).length,
    }, start);
  }
}

export const iconSystemSkill = new IconSystemSkill();
