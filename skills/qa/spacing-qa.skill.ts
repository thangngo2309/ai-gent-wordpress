/**
 * Spacing QA Skill.
 *
 * Reviews spacing consistency: section vertical rhythm, card padding,
 * gap values, and the overall white-space usage quality.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildSpacingQaBlock(): string {
  return `
━━ SPACING & RHYTHM REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate spacing quality as a detail-obsessed UI designer who thinks in 8px grid units.

SECTION VERTICAL RHYTHM:
□ Section padding-top and padding-bottom are consistent (e.g., 80–120px on desktop).
□ Sections don't feel cramped (too little padding) or wasteful (too much empty space).
□ Whitespace between the heading and the content below it is intentional (~24–40px).
□ No two adjacent sections have the same background — or if they do, a divider separates them.

CARD SPACING:
□ Cards in a grid have consistent gap (24–32px is standard).
□ Card internal padding is consistent across all cards in the same section (16–24px).
□ Card content (heading, body, CTA) has consistent spacing within the card.
□ No card has its content touching the card edge (no zero-padding cards).

COMPONENT INTERNAL SPACING:
□ Button padding is generous (14–20px vertical, 24–32px horizontal).
□ Input fields (if any) have appropriate internal padding (12–16px).
□ Navigation items have adequate horizontal spacing (16–24px gap).
□ Icon + label combos have consistent gap (8–12px between icon and text).

WHITE-SPACE QUALITY:
□ Whitespace is used intentionally to create breathing room, not randomly.
□ The page doesn't feel "claustrophobic" (too little spacing) or "empty" (too much).
□ Premium whitespace usage: margins between sections feel balanced.
□ No orphaned spacing (random extra padding/margin on one side of an element).

SPACING FAILURE PATTERNS:
✗ Section padding is 8px or less — content looks crammed.
✗ Cards in a grid have no gap — they touch each other.
✗ Section heading has no breathing room below it before the card grid starts.
✗ Button padding is so small the button looks like a link, not a button.
✗ Mixed spacing scales (some sections use 60px padding, others use 200px padding).
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface SpacingQaOutput {
  criteriaBlock: string;
}

export class SpacingQaSkill extends BaseSkill<void, SpacingQaOutput> {
  readonly name = "qa/spacing";
  readonly description = "Spacing QA: vertical rhythm, card padding, gap consistency, whitespace quality";
  readonly version = "1.0.0";


  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<SpacingQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildSpacingQaBlock();
    return {
      success: true,
      data: { criteriaBlock },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const spacingQaSkill = new SpacingQaSkill();
