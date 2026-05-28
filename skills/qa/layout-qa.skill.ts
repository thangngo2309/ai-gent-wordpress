/**
 * Layout QA Skill.
 *
 * Reviews grid and flex layout integrity: column alignment,
 * overflow detection, container sizing, and structural consistency.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildLayoutQaBlock(): string {
  return `
━━ LAYOUT & STRUCTURE REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate layout integrity as a frontend engineer doing a QA pass.

GRID ALIGNMENT:
□ Card grids have equal-height rows (cards in the same row are aligned at bottom).
□ Grid column gaps are consistent within each section.
□ Grid does not collapse prematurely (3-col should NOT collapse to 1-col at 900px).
□ Column content aligns to an invisible baseline grid.

OVERFLOW & CONTAINMENT:
□ No element extends beyond the viewport width at 1440px.
□ No element extends beyond 390px container on mobile.
□ Long text strings (product names, headings) break or truncate gracefully.
□ Images do not overflow their containers.
□ Absolutely/fixed positioned elements do not overlap main content.

CONTAINER SIZING:
□ Main content containers use max-width (typically 1200–1280px) with auto margins.
□ Section inner containers do not stretch to full viewport edge.
□ Full-bleed background sections have inner content properly constrained.

FLEXBOX & GRID PATTERNS:
□ Flex containers use gap (not margin hacks) for spacing between children.
□ Grid children have min-width: 0 to prevent overflow.
□ Flex/grid containers do not create unintended scrollable overflows.
□ Flex children with long text content do not push siblings out of layout.

SECTION STRUCTURE:
□ Every major section has correct: padding-top, padding-bottom, container wrapper.
□ Section headings are centered or left-aligned consistently.
□ Footer layout uses grid or flex for the multi-column structure.
□ Fixed header does not overlap the first section's content (body has padding-top).

LAYOUT FAILURE PATTERNS (critical):
✗ Cards in a 4-column grid have wildly different heights.
✗ Text content causes a section to expand unexpectedly.
✗ A section has no horizontal padding (text runs edge-to-edge).
✗ Fixed header overlaps the hero section (no body padding-top offset).
✗ Footer columns overflow or wrap unexpectedly on desktop.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface LayoutQaOutput {
  criteriaBlock: string;
}

export class LayoutQaSkill extends BaseSkill<void, LayoutQaOutput> {
  readonly name = "qa/layout";
  readonly description = "Layout QA: grid alignment, overflow, container sizing, flex/grid integrity";
  readonly version = "1.0.0";


  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<LayoutQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildLayoutQaBlock();
    return {
      success: true,
      data: { criteriaBlock },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const layoutQaSkill = new LayoutQaSkill();
