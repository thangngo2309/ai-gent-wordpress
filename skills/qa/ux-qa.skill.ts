/**
 * UX QA Skill.
 *
 * Reviews user experience quality: CTAs, navigation clarity,
 * conversion funnel elements, trust signals, and user flow.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildUxQaBlock(): string {
  return `
━━ UX QUALITY REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate user experience quality as a conversion-focused UX designer.

CTA (CALL-TO-ACTION) QUALITY:
□ Primary CTA button is immediately visible above the fold (hero section).
□ CTA button uses a high-contrast filled style — not text-only or ghost button.
□ CTA label is action-oriented ("Buy Now", "Get Started", "View Catalogue").
□ Secondary CTAs exist throughout the page (at least 1 per major section).
□ CTA buttons are large enough to be easily clicked (min 44px height desktop).

NAVIGATION:
□ Site navigation is horizontal and clearly readable in the header.
□ Logo is in the expected top-left position.
□ Navigation links are concise (4–7 items max, not a wall of text).
□ Active/current page is visually distinguished.
□ A clear "contact" or "buy" link is present in the nav.

TRUST & CONVERSION SIGNALS:
□ Hero section includes a concrete trust signal (stat, badge, certification, client logo).
□ Testimonials or reviews section is present and visually credible.
□ Product/service benefits are clearly communicated (not buried in paragraphs).
□ Contact information or WhatsApp/phone CTA is visible.

CONTENT HIERARCHY & SCANNABILITY:
□ Visitors can understand the core offering within 3 seconds above the fold.
□ Section headings are scannable — the page makes sense when skimming headings only.
□ Price or key specification is prominently displayed where relevant.
□ Content does not require scrolling past 3 sections to find what to do next.

INTERACTION PATTERNS:
□ Hover states on interactive elements (buttons, cards, links) are visually apparent.
□ Focus states are visible for keyboard navigation.
□ Forms (if any) have clearly labeled inputs.

UX FAILURE PATTERNS (these hurt conversions significantly):
✗ No primary CTA above the fold.
✗ CTA button color blends into background (invisible or low contrast).
✗ Navigation requires horizontal scrolling.
✗ The page's core value proposition is not clear in the hero.
✗ No trust signal or social proof anywhere on the page.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface UxQaOutput {
  criteriaBlock: string;
}

export class UxQaSkill extends BaseSkill<void, UxQaOutput> {
  readonly name = "qa/ux";
  readonly description = "UX quality review: CTAs, navigation, conversion elements, trust signals";
  readonly version = "1.0.0";


  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<UxQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildUxQaBlock();
    return {
      success: true,
      data: { criteriaBlock },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const uxQaSkill = new UxQaSkill();
