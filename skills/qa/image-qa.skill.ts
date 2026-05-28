/**
 * Image QA Skill.
 *
 * Detects placeholder images, validates SVG illustration quality,
 * checks aspect ratios, object-fit handling, and visual richness
 * of card image areas. This is one of the most critical QA checks
 * since poor image areas are the most visible quality failure.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PROMPT BLOCK
// ─────────────────────────────────────────────────────────────────────────────

export function buildImageQaBlock(): string {
  return `
━━ IMAGE & VISUAL CONTENT REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate image quality as an art director reviewing a client presentation.
Image areas are the most visible quality indicator on product/service sites.

CARD IMAGE AREA RICHNESS (critical):
□ Product card image areas look RICH — filled with colorful gradients or detailed SVG illustrations.
□ Category card thumbnails are visually distinct from each other (different colors or icons).
□ Article/editorial card images show actual illustration content (not empty boxes).
□ NO card image area looks like a blank grey/white/monochrome placeholder.
□ SVG illustrations inside image areas are detailed enough to tell what the product/service is.

SVG ILLUSTRATION QUALITY:
□ SVG shapes are clearly VISIBLE against their container background.
□ SVG shapes use CONTRASTING colors — white/light on dark backgrounds, dark on light backgrounds.
□ SVG illustrations fill at least 60% of the card image area (not a tiny 48px icon in a 300px box).
□ SVG uses width="100%" height="100%" (not fixed pixel dimensions that create whitespace).
□ Battery/product illustration shapes are recognizable at card thumbnail size.
□ Hero visual SVG fills the right column properly (not constrained to 400px in a 640px column).

ICON CARD PROPORTIONS:
□ Feature/category cards using a small icon have proportionate icon areas (max 120px tall).
□ Icon areas are NOT oversized gradient banners (not padding: 40px+ with a 48px icon inside).
□ The icon SVG is 56–72px and centered in its area with reasonable padding (24px).
□ Icon areas feel purposeful, not like accidental colored blocks.

ASPECT RATIO CONSISTENCY:
□ All product card image areas use the same aspect ratio (4:3 or 16:9) — no height mismatches.
□ Article card images use a consistent aspect ratio.
□ Images do NOT stretch or distort (object-fit: cover is applied).
□ No image area has a fixed height that causes different-sized images to crop awkwardly.

PLACEHOLDER DETECTION:
□ No external placeholder URLs (picsum, lorempixel, placehold.it, dummyimage).
□ No empty grey/white boxes where content should be (pure CSS background with no illustration).
□ No generic stock-image-style SVG that is clearly unrelated to the site's industry.
□ No "Image" text or src="#" placeholder attributes.

IMAGE FAILURE PATTERNS (score 0 in this dimension for):
✗ Card image areas are empty grey or white boxes.
✗ SVG fills are the same color as the container gradient background (invisible shapes).
✗ A 48px icon is centered in a 200px-tall gradient area — oversized banner effect.
✗ Hero visual is too small (constrained to 400px max-width in a 600px+ column).
✗ All image areas look identical (same gradient, same icon, no visual differentiation).
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface ImageQaOutput {
  criteriaBlock: string;
}

export class ImageQaSkill extends BaseSkill<void, ImageQaOutput> {
  readonly name = "qa/image";
  readonly description = "Image QA: placeholder detection, SVG illustration quality, aspect ratio, visual richness";
  readonly version = "1.0.0";


  async execute(_input: void, _ctx: GenerationContext): Promise<SkillResult<ImageQaOutput>> {
    const start = Date.now();
    this.logs = [];
    const criteriaBlock = buildImageQaBlock();
    return {
      success: true,
      data: { criteriaBlock },
      logs: this.logs,
      retries: 0,
      durationMs: Date.now() - start,
    };
  }
}

export const imageQaSkill = new ImageQaSkill();
