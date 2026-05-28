/**
 * QA Pipeline.
 *
 * Orchestrates the advanced QA review layer after theme/plugin generation.
 * Wraps the existing screenshot-based visual review with the new multi-
 * dimension QA scoring system.
 *
 * Integration:
 * - Can be called from generation.pipeline.ts AFTER code generation
 * - Does NOT replace the existing validation pipeline
 * - Does NOT change the orchestration flow in agent.ts
 * - Provides enriched QA report with per-dimension scores and auto-fix hints
 *
 * Usage:
 *   const qaResult = await runQaPipeline(genCtx, { previewUrl, screenshotPaths });
 */

import type { GenerationContext } from "../contracts/types.js";
import {
  buildQaMasterPrompt,
  parseQaMasterResult,
  type QaMasterResult,
} from "../../skills/qa/qa-master.skill.js";
import {
  calculateWeightedScore,
  getAutoFixRecommendations,
  UI_SCORE_THRESHOLDS,
} from "../../skills/qa/ui-score.skill.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("qa-pipeline");

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface QaPipelineOptions {
  /** Running preview URL for screenshot capture */
  previewUrl?: string;
  /** Pre-captured screenshot file paths (skips Playwright capture) */
  screenshotPaths?: string[];
  /** Raw HTML from preview server */
  previewHtml?: string;
  /** Preview server status (e.g. "200") */
  previewStatus?: string;
  /** Server stdout/stderr */
  serverOutput?: string;
  /** Brand context string */
  brandContext?: string;
  /** Include WooCommerce QA criteria */
  includeEcommerce?: boolean;
  /** Score threshold to pass (default: UI_SCORE_THRESHOLDS.pass) */
  passScore?: number;
}

export interface QaPipelineResult {
  /** Whether the QA passed */
  passed: boolean;
  /** Weighted overall score 0–100 */
  overallScore: number;
  desktopScore: number;
  mobileScore: number;
  /** "pass" | "polish" | "fail" */
  severity: "pass" | "polish" | "fail";
  /** Per-dimension score breakdown */
  dimensionScores: Record<string, number>;
  /** Critical issues found */
  criticalIssues: string[];
  /** Warning-level issues */
  warnings: string[];
  /** CSS/HTML auto-fix hints from LLM */
  autoFixHints: string[];
  /** Computed fix recommendations from ui-score skill */
  autoFixRecommendations: string[];
  /** Summary explanation from the LLM reviewer */
  explanation: string;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the advanced QA review pipeline.
 *
 * If screenshotPaths are provided, sends them to the Vision API using the
 * QA master prompt. Falls back to text-only analysis if no screenshots.
 *
 * Returns a QaPipelineResult with per-dimension scores and auto-fix hints.
 * Does NOT mutate GenCtx — purely returns a report.
 */
export async function runQaPipeline(
  genCtx: GenerationContext,
  opts: QaPipelineOptions = {},
): Promise<QaPipelineResult> {
  const start = Date.now();
  const passScore = opts.passScore ?? UI_SCORE_THRESHOLDS.pass;
  const idea = genCtx.idea ?? "";
  const brandName = genCtx.analysis?.brandName ?? idea;
  const includeEcommerce =
    opts.includeEcommerce ??
    /woocommerce|woo\b|e-?commerce|shop|store|cart|checkout/i.test(idea);

  log.info("Starting QA pipeline…");

  // Build brand context
  const brandContext = [
    `Brand: ${brandName}`,
    genCtx.analysis?.targetAudience ? `Audience: ${genCtx.analysis.targetAudience}` : null,
    genCtx.analysis?.designDirection?.tone
      ? `Design tone: ${genCtx.analysis.designDirection.tone}`
      : null,
    genCtx.analysis?.designDirection?.colorPalette
      ? `Color palette: ${genCtx.analysis.designDirection.colorPalette}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Build the QA master prompt
  const screenshotPaths = opts.screenshotPaths ?? [];
  const prompt = buildQaMasterPrompt({
    previewStatus: opts.previewStatus ?? "200",
    previewHtml: opts.previewHtml ?? "(HTML not provided)",
    serverOutput: opts.serverOutput ?? "(server output not provided)",
    brandContext,
    screenshotCount: screenshotPaths.length || 2,
    includeEcommerce,
  });

  log.info(`QA prompt built (${prompt.length} chars, ${screenshotPaths.length} screenshots)`);

  // Call Vision API or text-only LLM
  let rawResult: Record<string, unknown> = {};
  try {
    if (screenshotPaths.length > 0) {
      rawResult = await callVisionApi(prompt, screenshotPaths);
    } else {
      rawResult = await callTextApi(prompt);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`QA pipeline LLM call failed: ${msg}`);
    // Return a conservative fallback result
    return buildFallbackResult(passScore, msg, Date.now() - start);
  }

  // Parse and normalize the result
  const qaResult = parseQaMasterResult(rawResult);

  const passed =
    qaResult.score >= passScore &&
    qaResult.severity !== "fail";

  log.info(
    `QA complete — score ${qaResult.score}/100 (${qaResult.severity}), ` +
    `desktop ${qaResult.desktopScore}, mobile ${qaResult.mobileScore}, ` +
    `passed: ${passed}`,
  );

  // Build dimension score map
  const dimensionScores: Record<string, number> = {};
  for (const dim of qaResult.dimensionScores) {
    dimensionScores[dim.id] = dim.score;
  }

  // Separate critical issues from warnings
  const criticalIssues = qaResult.issues.filter((_, i) => i < 5); // First 5 = most critical
  const warnings = qaResult.issues.slice(5);

  return {
    passed,
    overallScore: qaResult.score,
    desktopScore: qaResult.desktopScore,
    mobileScore: qaResult.mobileScore,
    severity: qaResult.severity,
    dimensionScores,
    criticalIssues,
    warnings,
    autoFixHints: qaResult.autoFixHints,
    autoFixRecommendations: qaResult.autoFixRecommendations,
    explanation: qaResult.explanation,
    durationMs: Date.now() - start,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  API HELPERS (thin wrappers — use existing env config)
// ─────────────────────────────────────────────────────────────────────────────

async function callVisionApi(
  prompt: string,
  imagePaths: string[],
): Promise<Record<string, unknown>> {
  const { existsSync } = await import("node:fs");
  const fs = await import("node:fs/promises");

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";
  const MAX_BYTES = 5 * 1024 * 1024;

  const contentBlocks: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
  ];

  for (const imgPath of imagePaths) {
    if (!existsSync(imgPath)) continue;
    const data = await fs.readFile(imgPath);
    const compressed = data.length > MAX_BYTES ? data.subarray(0, MAX_BYTES) : data;
    contentBlocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: compressed.toString("base64") },
    });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      messages: [{ role: "user", content: contentBlocks }],
    }),
  });

  if (!res.ok) throw new Error(`Vision API error: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = body.content?.[0]?.text ?? "{}";

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Extract JSON from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, unknown>;
    throw new Error("Could not parse QA pipeline JSON response");
  }
}

async function callTextApi(prompt: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Text API error: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = body.content?.[0]?.text ?? "{}";

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, unknown>;
    throw new Error("Could not parse QA pipeline text API response");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

function buildFallbackResult(passScore: number, reason: string, durationMs: number): QaPipelineResult {
  const { dimensions } = calculateWeightedScore({});
  return {
    passed: false,
    overallScore: 0,
    desktopScore: 0,
    mobileScore: 0,
    severity: "fail",
    dimensionScores: {},
    criticalIssues: [`QA pipeline failed: ${reason}`],
    warnings: [],
    autoFixHints: [],
    autoFixRecommendations: getAutoFixRecommendations(dimensions),
    explanation: `QA pipeline could not complete: ${reason}`,
    durationMs,
  };
}
