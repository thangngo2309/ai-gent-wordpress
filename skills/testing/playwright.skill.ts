/**
 * Playwright Visual Testing Skill.
 *
 * Wraps the Playwright screenshot/visual-review logic already present in
 * agent.ts so it can be reused as a standalone skill.
 *
 * Captures viewport screenshots, compresses them with Sharp (when available)
 * and returns base64-encoded images for LLM visual review.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { createLogger } from "../../src/core/logger.js";

const logger = createLogger("playwright-skill");

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PlaywrightSkillInput {
  /** Full URL(s) to capture */
  urls: string[];
  /** Viewport widths to screenshot (default: [1280]) */
  viewports?: number[];
  /** Max width for compressed screenshot (default: 1280) */
  maxWidth?: number;
  /** Screenshot quality 1-100 (default: 80) */
  quality?: number;
}

export interface CapturedPage {
  url: string;
  viewport: number;
  /** Base64 JPEG */
  imageBase64: string;
  /** Size in bytes */
  size: number;
}

export interface PlaywrightResult {
  pages: CapturedPage[];
  errors: Array<{ url: string; error: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export class PlaywrightSkill extends BaseSkill<PlaywrightSkillInput, PlaywrightResult> {
  readonly name = "testing/playwright";
  readonly description = "Captures Playwright screenshots for visual review";
  readonly version = "1.0.0";

  validators = [];

  async execute(
    input: PlaywrightSkillInput,
    _ctx: GenerationContext,
  ): Promise<SkillResult<PlaywrightResult>> {
    const start = Date.now();
    this.logs = [];

    const viewports = input.viewports ?? [1280];
    const maxWidth = input.maxWidth ?? 1280;
    const quality = input.quality ?? 80;

    let playwright: typeof import("playwright") | null = null;
    try {
      playwright = await import("playwright");
    } catch {
      this.log("playwright not installed — skipping screenshot capture");
      return this.buildResult(
        true,
        { pages: [], errors: [] },
        start,
        0,
        undefined,
        ["playwright not installed — run: npm install playwright"],
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sharp: ((buf: Buffer) => any) | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sharpModule = await import("sharp") as any;
      sharp = (sharpModule.default ?? sharpModule) as typeof sharp;
    } catch {
      this.log("sharp not installed — screenshots will not be compressed");
    }

    const browser = await playwright.chromium.launch({ headless: true });
    const pages: CapturedPage[] = [];
    const errors: Array<{ url: string; error: string }> = [];

    try {
      for (const url of input.urls) {
        for (const viewport of viewports) {
          this.log(`Capturing ${url} @ ${viewport}px`);
          const bCtx = await browser.newContext({
            viewport: { width: viewport, height: 900 },
          });
          const page = await bCtx.newPage();

          try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
            await page.waitForTimeout(1500);

            const rawBuf = await page.screenshot({ type: "jpeg", quality });

            let finalBuf: Buffer = rawBuf;
            if (sharp != null) {
              try {
                const sharpFn = sharp as (buf: Buffer) => { resize: (w: number) => { jpeg: (opts: { quality: number }) => { toBuffer: () => Promise<Buffer> } } };
                finalBuf = await sharpFn(rawBuf)
                  .resize(maxWidth)
                  .jpeg({ quality })
                  .toBuffer();
              } catch (e) {
                this.log(`Sharp compression failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            }

            pages.push({
              url,
              viewport,
              imageBase64: finalBuf.toString("base64"),
              size: finalBuf.length,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push({ url, error: msg });
            this.log(`Screenshot failed for ${url}: ${msg}`);
          } finally {
            await bCtx.close();
          }
        }
      }
    } finally {
      await browser.close();
    }

    this.log(`Captured ${pages.length} screenshot(s), ${errors.length} error(s)`);

    return this.buildResult(
      errors.length === 0,
      { pages, errors },
      start,
    );
  }
}

export const playwrightSkill = new PlaywrightSkill();
