/**
 * LLM client wrapper.
 *
 * Provides a typed, injectable LLM interface used by skills and agents.
 * The underlying implementation calls the Anthropic API (or falls back to
 * mock mode when ANTHROPIC_API_KEY is absent / FORCE_MOCK_MODE=true).
 */

import { createLogger } from "./logger.js";
import { LLM_SYSTEM } from "../prompts/wordpress-system.js";

const logger = createLogger("llm");

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmOptions {
  maxTokens?: number;
  /** Override the default system prompt for this call */
  systemPrompt?: string;
}

export interface LlmClient {
  complete(prompt: string, options?: LlmOptions): Promise<unknown>;
  /** Returns true when operating in mock/offline mode */
  isMock: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repairLlmJson(raw: string): string {
  const out: string[] = [];
  let inStr = false;
  let esc = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { out.push(ch); esc = false; continue; }
    if (ch === "\\" && inStr) { out.push(ch); esc = true; continue; }

    if (ch === '"') {
      if (!inStr) { inStr = true; out.push(ch); continue; }
      let j = i + 1;
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\n' || raw[j] === '\r' || raw[j] === '\t')) j++;
      const next = raw[j];
      if (next === ':' || next === ',' || next === '}' || next === ']' || j >= raw.length) {
        inStr = false; out.push(ch);
      } else {
        out.push('\\'); out.push('"');
      }
      continue;
    }
    out.push(ch);
  }
  return out.join('');
}

function parseJsonFromText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { return JSON.parse(repairLlmJson(fenced[1].trim())); }
  }

  const raw = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (raw) {
    try { return JSON.parse(raw[1]); } catch { return JSON.parse(repairLlmJson(raw[1])); }
  }

  throw new Error(`No JSON found in LLM response: ${text.slice(0, 300)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANTHROPIC CLIENT
// ─────────────────────────────────────────────────────────────────────────────

class AnthropicLlmClient implements LlmClient {
  readonly isMock = false;

  private remoteCallCallback?: () => void;

  setRemoteCallCallback(cb: () => void): void {
    this.remoteCallCallback = cb;
  }

  async complete(prompt: string, options: LlmOptions = {}): Promise<unknown> {
    const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";
    const maxTokens = options.maxTokens ?? 16384;
    const systemPrompt = options.systemPrompt ?? LLM_SYSTEM;
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";

    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }

    const MAX_API_RETRIES = 6;
    const FETCH_TIMEOUT_MS = 420_000;

    for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      this.remoteCallCallback?.();

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
            system: systemPrompt,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        const isAbort = err instanceof Error && err.name === "AbortError";
        const msg = isAbort
          ? `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
          : err instanceof Error ? err.message : String(err);

        if (attempt < MAX_API_RETRIES) {
          const wait = Math.min(5 * 2 ** (attempt - 1), 30);
          logger.warn(`Network error (attempt ${attempt}): ${msg}. Retrying in ${wait}s…`);
          await sleep(wait * 1000);
          continue;
        }
        throw new Error(`LLM network error after ${MAX_API_RETRIES} retries: ${msg}`);
      }
      clearTimeout(timer);

      if (res.status === 429 || res.status === 529) {
        const retryAfter = res.headers.get("retry-after");
        const wait = retryAfter ? parseInt(retryAfter, 10) : 30 * attempt;
        logger.warn(`API ${res.status} — waiting ${wait}s before retry ${attempt + 1}…`);
        if (attempt < MAX_API_RETRIES) { await sleep(wait * 1000); continue; }
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
      }

      const json = (await res.json()) as {
        content?: { text?: string }[];
        stop_reason?: string;
      };

      const text = json.content?.[0]?.text ?? "";

      if (json.stop_reason === "max_tokens") {
        throw new Error(`LLM response truncated at ${maxTokens} tokens`);
      }

      return parseJsonFromText(text);
    }

    throw new Error("LLM: exhausted all retries");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOCK CLIENT
// ─────────────────────────────────────────────────────────────────────────────

class MockLlmClient implements LlmClient {
  readonly isMock = true;

  async complete(prompt: string): Promise<unknown> {
    logger.warn("Mock LLM active — set ANTHROPIC_API_KEY for real generation");

    if (prompt.includes("[ANALYZE_IDEA]")) {
      return {
        projectType: "wordpress_theme",
        projectName: "mock-theme",
        brandName: "Mock Theme",
        summary: "A mock WordPress theme for testing.",
        targetAudience: "developers",
        goals: ["Test the pipeline"],
        features: [],
        userStories: [],
        designDirection: { tone: "modern", colorPalette: "neutral", typography: "sans-serif", inspiration: [] },
        nonFunctionalRequirements: { performance: [], accessibility: ["WCAG 2.1 AA"], seo: [] },
        contentRequirements: [],
        techStack: { frontend: ["HTML5", "CSS3"], backend: ["PHP 8.0+", "WordPress 6.0+"], devtools: ["WP-CLI"] },
      };
    }

    if (prompt.includes("[BUILD_SPEC]")) {
      return {
        projectType: "wordpress_theme",
        architecture: "Standard WordPress theme",
        fileStructure: [
          { filePath: "style.css", description: "Theme stylesheet" },
          { filePath: "functions.php", description: "Theme functions" },
          { filePath: "index.php", description: "Main template" },
          { filePath: "header.php", description: "Header template" },
          { filePath: "footer.php", description: "Footer template" },
          { filePath: "inc/theme-data.php", description: "Theme data functions" },
          { filePath: "inc/customizer.php", description: "Customizer settings" },
        ],
        apiEndpoints: [],
        buildScript: "",
        testScript: "php -l *.php",
      };
    }

    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  FACTORY
// ─────────────────────────────────────────────────────────────────────────────

export function createLlmClient(): LlmClient {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const forceMock = process.env.FORCE_MOCK_MODE === "true";

  if (forceMock || !apiKey) {
    logger.warn("Using mock LLM client (no API key or FORCE_MOCK_MODE=true)");
    return new MockLlmClient();
  }

  return new AnthropicLlmClient();
}

/** Singleton LLM client — created once and reused */
let _defaultClient: LlmClient | null = null;

export function getDefaultLlmClient(): LlmClient {
  if (!_defaultClient) {
    _defaultClient = createLlmClient();
  }
  return _defaultClient;
}
