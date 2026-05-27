/**
 * QA Visual Review Agent.
 *
 * Takes Playwright screenshots of a running WordPress Playground preview,
 * sends them to the Anthropic vision API, and writes a structured report
 * to `.agent-artifacts/`.
 *
 * Usage:
 *   const result = await qaVisualAgent("http://localhost:9401", projectDir);
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { AgentResult } from "../contracts/types.js";
import { createLogger } from "../core/logger.js";

// Load .env from workspace root so the agent works as a standalone script
import dotenv from "dotenv";
dotenv.config();

const log = createLogger("qa-visual-agent");

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface QaIssue {
  severity: "critical" | "warning" | "info";
  category: "layout" | "typography" | "images" | "color" | "spacing" | "mobile" | "content";
  description: string;
}

export interface QaVisualReport {
  generatedAt: string;
  previewUrl: string;
  round: number;
  overallScore: number;
  desktopScore: number;
  mobileScore: number;
  verdict: "pass" | "needs-polish" | "fail";
  issues: QaIssue[];
  summary: string;
  screenshotPaths: string[];
  reportPaths: {
    json: string;
    markdown: string;
  };
}

export interface QaVisualOptions {
  /** Review round number for artifact naming (default: 1) */
  round?: number;
  /** Page path to review (default: "/") */
  pagePath?: string;
  /** Passing score threshold 0–100 (default: 80) */
  passScore?: number;
  /** Additional context injected into the review prompt */
  brandContext?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCREENSHOT CAPTURE
// ─────────────────────────────────────────────────────────────────────────────

interface ScreenshotResult {
  paths: string[];
  errors: string[];
}

async function captureScreenshots(
  url: string,
  artifactsDir: string,
): Promise<ScreenshotResult> {
  const paths: string[] = [];
  const errors: string[] = [];

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    const variants = [
      { name: "desktop", viewport: { width: 1440, height: 1600 } },
      { name: "mobile", viewport: { width: 390, height: 1200 } },
    ];

    try {
      for (const variant of variants) {
        const page = await browser.newPage({
          viewport: variant.viewport,
          deviceScaleFactor: 1,
        });
        try {
          await page.goto(url, { waitUntil: "load", timeout: 30_000 });
          await page
            .waitForLoadState("networkidle", { timeout: 10_000 })
            .catch(() => undefined);
          // Freeze animations for a stable screenshot
          await page
            .addStyleTag({
              content:
                "*,*::before,*::after{animation:none!important;transition:none!important;} html{scroll-behavior:auto!important;}",
            })
            .catch(() => undefined);
          await page.waitForTimeout(800);
          const screenshotPath = path.join(
            artifactsDir,
            `visual-${variant.name}.png`,
          );
          await page.screenshot({ path: screenshotPath, fullPage: true });
          paths.push(screenshotPath);
          log.info(`Screenshot saved: visual-${variant.name}.png`);
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    log.warn(`Screenshot capture failed: ${msg}`);
  }

  return { paths, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
//  IMAGE COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────

async function prepareImageData(imagePath: string): Promise<Buffer> {
  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
  const data = await fs.readFile(imagePath);
  if (data.length <= MAX_BYTES) return data;

  // Attempt to compress with sharp if available
  try {
    const sharp = (await import("sharp")).default;
    const compressed = await sharp(data)
      .resize({ width: 1440, withoutEnlargement: true })
      .png({ quality: 75 })
      .toBuffer();
    log.info(
      `Compressed ${path.basename(imagePath)}: ${data.length} → ${compressed.length} bytes`,
    );
    return compressed;
  } catch {
    log.warn("sharp not available — sending uncompressed image");
    return data;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VISION LLM CALL
// ─────────────────────────────────────────────────────────────────────────────

interface RawScoreResponse {
  overallScore?: unknown;
  desktopScore?: unknown;
  mobileScore?: unknown;
  verdict?: unknown;
  issues?: unknown;
  summary?: unknown;
}

function buildReviewPrompt(
  previewUrl: string,
  brandContext: string,
  screenshotCount: number,
): string {
  return `[QA_VISUAL_REVIEW]
You are a strict, detail-obsessed senior UI/UX quality reviewer for a WordPress theme.
Your job is to find EVERY flaw. Default to scepticism — a score ≥ 85 means the page genuinely
looks polished and professional to a paying client, not merely "functional".

Analyse ALL ${screenshotCount} screenshot(s) attached (desktop first, then mobile) pixel by pixel.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${brandContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY STYLE CHECKLIST — inspect EACH item individually
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For every item below, decide: PASS / WARNING / FAIL and note specifics.

CARD IMAGES
□ Product card image areas are visually rich — NOT empty grey/white boxes or tiny icons.
  They should show a colourful gradient, brand illustration, or inline SVG that fills the area.
□ Card image areas have consistent height/aspect-ratio (not wildly different heights).
□ No ::before placeholder SVG overlapping an actual inline SVG in the same container.
□ Category cards have distinct, on-brand visual thumbnails (not blank placeholder areas).

HERO SECTION
□ Hero illustration/visual on the right side is clearly visible (not washed-out by an overlay).
□ Hero shows headline, sub-copy, CTA button, and a trust signal above the fold on desktop.
□ CTA buttons have strong visual weight (filled primary colour, not subtle/low-contrast).
□ Hero background gradient is visually appealing and brand-consistent.

TYPOGRAPHY & HIERARCHY
□ H1 is clearly larger than H2 which is clearly larger than body text (strong hierarchy).
□ A distinct heading font is used (not generic system-ui everywhere).
□ Body text is 16px+ and readable (not squished or low-contrast on the background).
□ Section labels/tags (upper-case eyebrow text) are properly styled and visible.

LAYOUT & STRUCTURE
□ Section dividers/backgrounds create clear visual separation between sections.
□ Grid columns align properly — no jagged column edges in product/article card grids.
□ No horizontal overflow or scrollbar on desktop (1440px wide).
□ Page sections fill the viewport width without unexpected narrow columns.

COLOUR & CONTRAST
□ Primary brand colour (#0ea5e9) is prominently used (not washed out or absent).
□ Accent colour is used for CTAs and highlights to create visual interest.
□ White text on coloured backgrounds has adequate contrast (≥ 4.5:1 ratio).
□ The page does NOT look like a generic grey/white SaaS template.

SPACING & POLISH
□ Section vertical padding is balanced — sections don't feel cramped or excessively tall.
□ Card padding/gap is consistent within each grid.
□ No orphaned or misaligned elements (stray buttons, floating text, broken flex items).

MOBILE (check mobile screenshot specifically)
□ No horizontal overflow at 390px width.
□ Navigation collapses to a hamburger or stacked layout (not overflowing).
□ CTA buttons are full-width or clearly accessible on mobile.
□ Card grids stack to 1 column on mobile without misalignment.
□ Text is legible (≥ 14px, no truncation on important content).

CONTENT QUALITY
□ Vietnamese text is fully rendered (no placeholder Latin text).
□ Stats/numbers in hero section are real data, not "0" or blank.
□ All sections are present and non-empty.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORING DIMENSIONS (each 0–100, averaged into overallScore)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Layout & Structure      — sections separated, grid aligned, no overflow
2. Typography Hierarchy    — size scale clear, font quality, readability
3. Card & Image Quality    — card visuals rich, images fit containers, no empty placeholders
4. Colour Harmony          — brand palette used, contrast sufficient, not generic grey
5. Spacing & Polish        — intentional rhythm, no awkward gaps or orphans
6. Mobile Responsiveness   — adapts cleanly, no overflow, legible text
7. Content Completeness    — all sections present, real content, no stub text

SCORE BENCHMARKS:
  95–100 : Exceptional — magazine/agency quality, client-ready immediately
  85–94  : Good — polished, professional, minor tweaks only
  70–84  : Mediocre — functional but generic or has noticeable visual issues
  50–69  : Poor — multiple layout/style problems that hurt professionalism
  0–49   : Broken — major rendering failures, broken layout, empty sections

VERDICT RULES:
- "pass"         : overallScore ≥ 85 AND no critical issues
- "needs-polish" : overallScore 70–84 OR any warning issues
- "fail"         : overallScore < 70 OR any critical issue

IMPORTANT: Be a strict critic. If card images look like empty placeholders, score the
"Card & Image Quality" dimension below 50. If the colour palette looks generic and grey,
score "Colour Harmony" below 60. Reserve scores above 85 for pages that genuinely impress.

List EVERY issue you find — even minor ones — with severity: "critical", "warning", or "info".

Respond ONLY with this JSON (no markdown fences, no extra keys):
{
  "overallScore": 0,
  "desktopScore": 0,
  "mobileScore": 0,
  "verdict": "pass",
  "issues": [
    { "severity": "critical|warning|info", "category": "layout|typography|images|color|spacing|mobile|content", "description": "Specific description of the issue including what section it affects" }
  ],
  "summary": "Two-paragraph executive summary: paragraph 1 covers what looks good, paragraph 2 lists the most important things to fix."
}

Preview URL: ${previewUrl}`;
}

async function callVisionApi(
  prompt: string,
  imagePaths: string[],
  maxTokens = 2048,
): Promise<RawScoreResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — cannot run vision review");
  }

  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";
  const MAX_RETRIES = 4;
  const TIMEOUT_MS = 120_000;

  // Build multimodal content array: text prompt first, then images
  const contentBlocks: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
  ];

  for (const imgPath of imagePaths) {
    if (!existsSync(imgPath)) {
      log.warn(`Screenshot not found, skipping: ${imgPath}`);
      continue;
    }
    const data = await prepareImageData(imgPath);
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: data.toString("base64"),
      },
    });
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: contentBlocks }],
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const msg = isAbort
        ? `Request timed out after ${TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err);
      if (attempt < MAX_RETRIES) {
        const wait = Math.min(10 * 2 ** (attempt - 1), 30);
        log.warn(`Network error (attempt ${attempt}): ${msg}. Retrying in ${wait}s…`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new Error(`Vision API network error after ${MAX_RETRIES} retries: ${msg}`);
    }
    clearTimeout(timer);

    if (res.status === 429 || res.status === 529) {
      const retryAfter = res.headers.get("retry-after");
      const wait = retryAfter ? parseInt(retryAfter, 10) : 30 * attempt;
      if (attempt < MAX_RETRIES) {
        log.warn(`API ${res.status} — waiting ${wait}s before retry ${attempt + 1}…`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 400)}`);
    }

    const json = (await res.json()) as { content?: { text?: string }[] };
    const text = json.content?.[0]?.text ?? "";

    // Try fenced JSON block first, then raw object
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1].trim()) as RawScoreResponse;

    const raw = text.match(/(\{[\s\S]*\})/);
    if (raw) return JSON.parse(raw[1]) as RawScoreResponse;

    throw new Error(`No JSON in vision API response: ${text.slice(0, 300)}`);
  }

  throw new Error("Vision API: exhausted all retries");
}

// ─────────────────────────────────────────────────────────────────────────────
//  REPORT WRITER
// ─────────────────────────────────────────────────────────────────────────────

async function writeReport(
  artifactsDir: string,
  report: Omit<QaVisualReport, "reportPaths">,
): Promise<{ json: string; markdown: string }> {
  await fs.mkdir(artifactsDir, { recursive: true });

  const jsonPath = path.join(
    artifactsDir,
    `visual-review-round-${report.round}.json`,
  );
  const markdownPath = path.join(
    artifactsDir,
    `visual-review-round-${report.round}.md`,
  );

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  const criticals = report.issues.filter((i) => i.severity === "critical");
  const warnings = report.issues.filter((i) => i.severity === "warning");
  const infos = report.issues.filter((i) => i.severity === "info");

  const issueLines =
    report.issues.length > 0
      ? report.issues.map(
          (i) => `| ${i.severity.toUpperCase()} | ${i.category} | ${i.description} |`,
        )
      : ["| — | — | No issues found |"];

  const verdictEmoji =
    report.verdict === "pass"
      ? "✅"
      : report.verdict === "needs-polish"
        ? "⚠️"
        : "❌";

  const markdown = [
    `# QA Visual Review — Round ${report.round}`,
    "",
    `> Generated: ${report.generatedAt}`,
    "",
    `## Result: ${verdictEmoji} ${report.verdict.toUpperCase()}`,
    "",
    `| Metric | Score |`,
    `|--------|-------|`,
    `| Overall | **${report.overallScore}** / 100 |`,
    `| Desktop | ${report.desktopScore} / 100 |`,
    `| Mobile  | ${report.mobileScore} / 100 |`,
    "",
    `## Summary`,
    "",
    report.summary,
    "",
    `## Issues (${criticals.length} critical · ${warnings.length} warnings · ${infos.length} info)`,
    "",
    "| Severity | Category | Description |",
    "|----------|----------|-------------|",
    ...issueLines,
    "",
    `## Screenshots`,
    "",
    ...(report.screenshotPaths.length > 0
      ? report.screenshotPaths.map((p) => `- \`${path.basename(p)}\``)
      : ["- No screenshots captured"]),
    "",
    `## Artifacts`,
    "",
    `- JSON: \`${path.basename(jsonPath)}\``,
    `- Markdown: \`${path.basename(markdownPath)}\``,
    "",
  ].join("\n");

  await fs.writeFile(markdownPath, markdown, "utf-8");
  return { json: jsonPath, markdown: markdownPath };
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN AGENT FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a QA visual review against a live preview URL.
 *
 * @param previewUrl - Full URL of the running WordPress Playground (e.g. "http://localhost:9401")
 * @param projectDir - Root directory of the generated theme/plugin (for artifact output)
 * @param options    - Optional configuration overrides
 */
export async function qaVisualAgent(
  previewUrl: string,
  projectDir: string,
  options: QaVisualOptions = {},
): Promise<AgentResult<QaVisualReport>> {
  const round = options.round ?? 1;
  const pagePath = options.pagePath ?? "/";
  const passScore = options.passScore ?? 85;
  const brandContext =
    options.brandContext ??
    "A Vietnamese lithium battery company (Hoàng Long Pin Lithium). " +
      "Brand colors: primary #0ea5e9, secondary #06b6d4, accent #f59e0b. " +
      "The site is a professional WordPress theme showcasing LiFePO₄ battery products.";

  const artifactsDir = path.join(projectDir, ".agent-artifacts");
  const targetUrl = previewUrl.replace(/\/$/, "") + pagePath;

  log.info(`QA visual review round ${round} → ${targetUrl}`);

  // ── 1. Capture screenshots ─────────────────────────────────────────────
  const screenshots = await captureScreenshots(targetUrl, artifactsDir);

  if (screenshots.errors.length > 0) {
    log.warn(`Screenshot errors: ${screenshots.errors.join(" | ")}`);
  }

  // ── 2. Build prompt ────────────────────────────────────────────────────
  const prompt = buildReviewPrompt(
    targetUrl,
    brandContext,
    screenshots.paths.length,
  );

  // ── 3. Call vision API ─────────────────────────────────────────────────
  let rawScore: RawScoreResponse;
  try {
    if (screenshots.paths.length > 0) {
      rawScore = await callVisionApi(prompt, screenshots.paths, 4096);
    } else {
      // No screenshots — fall back to a text-only description stub
      log.warn("No screenshots available — skipping vision API call");
      rawScore = {
        overallScore: 0,
        desktopScore: 0,
        mobileScore: 0,
        verdict: "fail",
        issues: [
          {
            severity: "critical",
            category: "layout",
            description:
              "Screenshots could not be captured. Ensure the preview URL is reachable.",
          },
        ],
        summary:
          "Visual review could not be completed because screenshots failed to capture.",
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Vision API call failed: ${msg}`);
    return {
      success: false,
      data: null as unknown as QaVisualReport,
      error: msg,
    };
  }

  // ── 4. Parse + normalise scores ────────────────────────────────────────
  const overallScore = Math.min(100, Math.max(0, Number(rawScore.overallScore ?? 0)));
  const desktopScore = Math.min(100, Math.max(0, Number(rawScore.desktopScore ?? overallScore)));
  const mobileScore = Math.min(100, Math.max(0, Number(rawScore.mobileScore ?? overallScore)));

  const rawIssues = Array.isArray(rawScore.issues) ? rawScore.issues : [];
  const issues: QaIssue[] = rawIssues.map((i: unknown) => {
    const obj = i as Partial<QaIssue>;
    const sev = obj.severity === "critical" || obj.severity === "warning" ? obj.severity : "info";
    const cat =
      ["layout", "typography", "images", "color", "spacing", "mobile", "content"].includes(
        String(obj.category),
      )
        ? (obj.category as QaIssue["category"])
        : "layout";
    return { severity: sev, category: cat, description: String(obj.description ?? "") };
  });

  const hasCritical = issues.some((i) => i.severity === "critical");
  let verdict: QaVisualReport["verdict"];
  if (hasCritical || overallScore < 60) {
    verdict = "fail";
  } else if (
    overallScore < passScore ||
    rawScore.verdict === "needs-polish" ||
    issues.some((i) => i.severity === "warning")
  ) {
    verdict = "needs-polish";
  } else {
    verdict = "pass";
  }

  const summary =
    typeof rawScore.summary === "string" && rawScore.summary.trim().length > 0
      ? rawScore.summary
      : `Visual review complete. Overall score: ${overallScore}/100.`;

  // ── 5. Write report ────────────────────────────────────────────────────
  const reportBase = {
    generatedAt: new Date().toISOString(),
    previewUrl: targetUrl,
    round,
    overallScore,
    desktopScore,
    mobileScore,
    verdict,
    issues,
    summary,
    screenshotPaths: screenshots.paths,
  };

  const reportPaths = await writeReport(artifactsDir, reportBase);

  const fullReport: QaVisualReport = { ...reportBase, reportPaths };

  log.info(
    `QA visual review done: verdict=${verdict} overall=${overallScore} ` +
      `desktop=${desktopScore} mobile=${mobileScore}`,
  );
  log.info(`  Report: ${reportPaths.markdown}`);

  return { success: verdict !== "fail", data: fullReport };
}
