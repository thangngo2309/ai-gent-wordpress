#!/usr/bin/env node
/**
 * AI Coding Agent Orchestrator
 *
 * Multi-agent pipeline for automated web application development.
 * Each agent runs sequentially with user approval between steps.
 *
 * Usage:
 *   node dist/agent.js "build a landing page for selling bikes"
 *   # or after compilation:
 *   node agent.js "build a landing page for selling bikes"
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  – Claude API key (omit for mock mode)
 *   CLAUDE_MODEL       – Model name (default: claude-sonnet-4-20250514)
 *   LOG_LEVEL          – DEBUG | INFO | WARN | ERROR (default: INFO)
 *   AUTO_APPROVE       – "true" to skip interactive approval prompts
 *   OUTPUT_DIR         – Root for generated projects (default: ./output)
 */

import "dotenv/config";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import { Dirent, existsSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { execSync, spawn, ChildProcess } from "node:child_process";

// ═════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═════════════════════════════════════════════════════════════════════════════

interface Feature {
  name: string;
  description: string;
  priority: "high" | "medium" | "low";
  acceptanceCriteria: string[];
}

interface TechStack {
  frontend: string[];
  backend: string[];
  devtools: string[];
}

interface UserStory {
  role: string;
  goal: string;
  rationale: string;
}

interface DesignDirection {
  tone: string;
  colorPalette: string;
  typography: string;
  inspiration: string[];
}

interface NonFunctionalRequirements {
  performance: string[];
  accessibility: string[];
  seo: string[];
}

interface FeatureAnalysis {
  projectName: string;
  brandName: string;
  summary: string;
  targetAudience: string;
  goals: string[];
  features: Feature[];
  userStories: UserStory[];
  designDirection: DesignDirection;
  nonFunctionalRequirements: NonFunctionalRequirements;
  contentRequirements: string[];
  techStack: TechStack;
}

interface FileSpec {
  filePath: string;
  description: string;
}

interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
}

interface ProjectSpec {
  architecture: string;
  fileStructure: FileSpec[];
  apiEndpoints: ApiEndpoint[];
  buildScript: string;
  testScript: string;
}

interface GeneratedFile {
  filePath: string;
  content: string;
}

interface BuildFixResponse {
  fixes: GeneratedFile[];
  explanation: string;
}

interface CommitMessageResponse {
  message: string;
}

interface AgentResult<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
}

interface SharedContext {
  idea: string;
  workspacePath: string;
  analysis: FeatureAnalysis | null;
  spec: ProjectSpec | null;
  generatedFiles: GeneratedFile[];
  buildLogs: string[];
  testLogs: string[];
  errors: string[];
}

interface Checkpoint {
  version: number;
  idea: string;
  completedAgents: number[];  // indices of completed agents (0-based)
  lastAgentIndex: number;      // index of last completed agent
  timestamp: string;
  analysis: FeatureAnalysis | null;
  spec: ProjectSpec | null;
  generatedFiles: GeneratedFile[];
  buildLogs: string[];
  testLogs: string[];
}

const CHECKPOINT_FILE = ".agent-checkpoint.json";

type ReviewAction = "approve" | "change" | "regenerate" | "quit";

interface ReviewChoice {
  action: ReviewAction;
  feedback?: string;
}

type AgentKind = "analysis" | "spec" | "codegen" | "build" | "test" | "commit";

interface AgentStep {
  name: string;
  description: string;
  run: (ctx: SharedContext) => Promise<AgentResult>;
  kind: AgentKind;
}

// ═════════════════════════════════════════════════════════════════════════════
//  LOGGER
// ═════════════════════════════════════════════════════════════════════════════

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const CURRENT_LOG_LEVEL: LogLevel = (() => {
  const env = (process.env.LOG_LEVEL ?? "INFO").toUpperCase();
  return env in LOG_LEVELS ? (env as LogLevel) : "INFO";
})();

function log(level: LogLevel, msg: string, data?: unknown): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[CURRENT_LOG_LEVEL]) return;
  const ts = new Date().toISOString();
  const payload = data !== undefined ? ` | ${JSON.stringify(data)}` : "";
  const line = `[${ts}] [${level.padEnd(5)}] ${msg}${payload}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOOLS — FILE SYSTEM (sandboxed to workspace)
// ═════════════════════════════════════════════════════════════════════════════

function resolveSafe(workspacePath: string, filePath: string): string {
  const resolved = path.resolve(workspacePath, filePath);
  const wsAbs = path.resolve(workspacePath);
  if (!resolved.startsWith(wsAbs + path.sep) && resolved !== wsAbs) {
    throw new Error(`Path traversal blocked: "${filePath}" escapes workspace`);
  }
  return resolved;
}

async function writeFileSafe(ws: string, fp: string, content: string): Promise<void> {
  const abs = resolveSafe(ws, fp);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  log("DEBUG", `Wrote ${fp} (${content.length} bytes)`);
}

async function readFileSafe(ws: string, fp: string): Promise<string> {
  return fs.readFile(resolveSafe(ws, fp), "utf-8");
}

async function listFilesSafe(ws: string, dir: string = "."): Promise<string[]> {
  const abs = resolveSafe(ws, dir);
  const entries = await fs.readdir(abs, { withFileTypes: true, recursive: true });
  return entries
    .filter((e: Dirent) => e.isFile())
    .map((e: Dirent) => path.relative(ws, path.join(e.parentPath ?? e.path, e.name)));
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOOLS — COMMAND EXECUTOR (sandboxed allow-list)
// ═════════════════════════════════════════════════════════════════════════════

const ALLOWED_BINS = new Set(["npm", "git", "node", "tsc", "php", "wp", "zip", "find"]);

function execSafe(
  command: string,
  cwd: string,
  timeoutMs = 120_000
): { stdout: string; success: boolean } {
  const bin = command.split(/\s+/)[0];
  if (!ALLOWED_BINS.has(bin)) {
    throw new Error(`Blocked command "${bin}". Allowed: ${[...ALLOWED_BINS].join(", ")}`);
  }
  log("DEBUG", `exec: ${command}`, { cwd });
  try {
    const stdout = execSync(command, {
      cwd,
      encoding: "utf-8" as const,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), success: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const out = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
    return { stdout: out || e.message || "unknown error", success: false };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
//  DESIGN SYSTEM — Creative guidelines for Claude (no rigid HTML template)
// ═════════════════════════════════════════════════════════════════════════════

const DESIGN_SYSTEM = `
## Design System Guidelines — WordPress Theme

You are a creative UI/UX designer building a WordPress theme.
Design a visually stunning, modern landing page theme.
Be creative with layout, animations, and visual hierarchy — but follow these technical rules:

### Font
- Use Google Font "Inter" loaded via wp_enqueue_style in functions.php
- Font weights: 400 (body), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold), 900 (black)
- Apply font-smoothing: antialiased

### Color Palette (define as CSS custom properties in style.css :root)
Choose a cohesive color palette that matches the user's topic. Include:
- --color-primary, --color-primary-foreground (main brand color + contrast text)
- --color-secondary, --color-secondary-foreground (accent color)
- --color-background, --color-foreground (page bg + default text)
- --color-muted, --color-muted-foreground (subtle backgrounds + dim text)
- --color-card, --color-card-foreground (card surfaces)
- --color-border (borders and dividers)
- --color-accent, --color-accent-foreground (highlights, CTAs)

### CSS Architecture (style.css + assets/css/custom.css)
- style.css MUST have the WordPress theme header comment at the very top
- Use CSS custom properties for colors (var(--color-primary) etc.)
- Use vanilla CSS with BEM-style class naming (.section-hero, .section-hero__title)
- Use CSS Grid and Flexbox for layouts
- Use @keyframes for animations (fade-in, slide-up, slide-in-left)
- Media queries for responsive: mobile-first approach

### CSS Reset & Base (in style.css after theme header)
\`\`\`css
/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background-color: var(--color-background, #ffffff);
  color: var(--color-foreground, #0f172a);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  line-height: 1.6;
}
html { scroll-behavior: smooth; }
img { max-width: 100%; height: auto; display: block; }
a { text-decoration: none; color: inherit; }

.container { max-width: 1280px; margin: 0 auto; padding: 0 1rem; }
@media (min-width: 768px) { .container { padding: 0 2.5rem; } }
@media (min-width: 1024px) { .container { padding: 0 5rem; } }

.glass {
  background-color: rgba(255,255,255,0.8);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,0.2);
}
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  background-color: var(--color-primary, #0ea5e9);
  color: #ffffff; padding: 0.75rem 1.5rem; border-radius: 0.5rem;
  font-weight: 600; transition: all 0.3s; border: none; cursor: pointer;
}
.btn-primary:hover { opacity: 0.9; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
.btn-primary:focus-visible { outline: 3px solid var(--color-primary, #0ea5e9); outline-offset: 2px; }
.btn-outline {
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid var(--color-primary, #0ea5e9);
  color: var(--color-primary, #0ea5e9);
  padding: 0.75rem 1.5rem; border-radius: 0.5rem;
  font-weight: 600; transition: all 0.3s; background: transparent; cursor: pointer;
}
.btn-outline:hover { background-color: var(--color-primary, #0ea5e9); color: #ffffff; }
.btn-outline:focus-visible { outline: 3px solid var(--color-primary, #0ea5e9); outline-offset: 2px; }

/* Skip-to-content link (accessibility — always include) */
.skip-to-content {
  position: absolute; top: -40px; left: 0; background: var(--color-primary, #0ea5e9);
  color: #ffffff; padding: 0.5rem 1rem; z-index: 100; border-radius: 0 0 0.25rem 0;
  transition: top 0.2s;
}
.skip-to-content:focus { top: 0; }

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
\`\`\`

### WordPress PHP Guidelines
1. **Escape all output**: Use esc_html(), esc_attr(), esc_url(), wp_kses_post()
2. **Translation ready**: Wrap strings with __(), _e(), esc_html__(), esc_html_e() using the theme text domain
3. **WordPress functions**: Use wp_nav_menu(), get_template_part(), the_custom_logo(), etc.
4. **Customizer API**: Use add_theme_support() and WordPress Customizer for theme settings
5. **WordPress hooks**: Use add_action(), add_filter() properly
6. **Template hierarchy**: Follow WordPress template hierarchy conventions
7. **Security**: Always sanitize inputs (sanitize_text_field, absint, etc.)

### Accessibility (WCAG 2.1 AA — required)
1. **Skip-to-content**: Add <a class="skip-to-content" href="#main-content">Skip to content</a> as first element in header.php
2. **ARIA landmarks**: Use role="banner" on <header>, role="navigation" on <nav>, role="main" on <main>, role="contentinfo" on <footer>
3. **Focus-visible**: All interactive elements (.btn-primary, .btn-outline, links, inputs) must have visible :focus-visible outline (3px solid var(--color-primary), offset: 2px)
4. **Reduced motion**: Wrap all @keyframes and transitions in @media (prefers-reduced-motion: no-preference) { } and add a blanket @media (prefers-reduced-motion: reduce) override in animations.css
5. **Images**: Every <img> must have a descriptive alt attribute; decorative images use alt=""
6. **Color contrast**: All text must meet WCAG AA contrast ratio (4.5:1 normal text, 3:1 large text)
7. **Semantic HTML**: Use <h1>–<h6> for heading hierarchy, <nav>, <article>, <section>, <aside>, <figure>/<figcaption>
8. **Form labels**: Every form input must have an associated <label> or aria-label attribute

### Design Principles
1. **Spacing**: Use generous padding (section padding: 4rem 0; @media(min-width:768px) { 6rem 0; })
2. **Container**: Use .container class (max-width: 1280px, centered)
3. **Responsive**: Mobile-first CSS, grid layouts that stack on mobile
4. **Images**: Use loremflickr.com URLs for topic-relevant placeholder images — keywords MUST match the theme/product topic
   - Format: https://loremflickr.com/{width}/{height}/{keyword1},{keyword2}?lock={n}
   - Use different ?lock=N (1, 2, 3 ...) per item so each image is unique but consistent on reload
   - Hero: 1920x1080, Products: 600x800, Categories: 800x600, Editorial: 800x600, Gallery: 800x600, About: 800x800
   - Choose 1-2 keywords from the theme topic (e.g. battery,energy for batteries; fashion,clothing for apparel)
5. **Hover effects**: transform: scale(1.05), box-shadow transitions, opacity changes — but only inside @media (prefers-reduced-motion: no-preference)
6. **Shadows**: Use box-shadow for depth hierarchy (sm, md, xl variants)
7. **Rounded corners**: border-radius for cards, featured items, avatars/buttons
8. **Transitions**: transition: all 0.3s ease for smooth interactions — wrap in prefers-reduced-motion
9. **Typography scale**: Use rem units with a clear size scale
10. **Dark overlays on images**: Use pseudo-elements or gradient overlays for text readability

### Page Sections (create each as a template-part)
1. **Header** — Sticky nav with glass effect, logo, wp_nav_menu, CTA button (header.php)
2. **Hero** — Full-width hero with background image, bold headline, subtitle, CTA (template-parts/hero.php)
3. **FeaturedProducts** — Product/item cards grid (4 cols desktop) with hover effects (template-parts/featured-products.php)
4. **Categories** — Visual category cards with overlay text (template-parts/categories.php)
5. **Editorial** — Featured article + article grid magazine layout (template-parts/editorial.php)
6. **Archives** — Image gallery grid with hover overlay (template-parts/archives-gallery.php)
7. **About** — Split layout: image + text with stats/values (template-parts/about.php)
8. **Footer** — Multi-column footer with nav, socials, newsletter (footer.php)
9. **BackToTop** — Fixed bottom-right floating button (template-parts/back-to-top.php)
`;

const REQUIRED_FILE_STRUCTURE = `
### Required File Structure (use EXACTLY these paths)
- style.css (WordPress theme header comment + base styles + all component styles)
- functions.php (Theme setup: enqueue styles/scripts, register menus, add_theme_support, Customizer settings)
- index.php (Main fallback template)
- front-page.php (Front page template — composes all sections via get_template_part)
- header.php (<!DOCTYPE html>, <head>, wp_head(), site header with nav)
- footer.php (Site footer, wp_footer(), </body></html>)
- page.php (Generic page template)
- 404.php (404 error page)
- screenshot.png (Theme screenshot — can be a placeholder)
- assets/css/animations.css (Keyframe animations and transitions)
- assets/js/main.js (Back-to-top, mobile menu toggle, scroll animations)
- inc/customizer.php (WordPress Customizer settings: hero text, colors, CTA)
- inc/theme-data.php (Static data arrays: products, categories, articles, archives, site config)
- template-parts/hero.php (Hero section)
- template-parts/featured-products.php (Product grid section)
- template-parts/categories.php (Category grid section)
- template-parts/editorial.php (Editorial/blog section)
- template-parts/archives-gallery.php (Archives gallery section)
- template-parts/about.php (About section)
- template-parts/back-to-top.php (Back to top floating button)
`;

// ─────────────────────────────────────────────────────────────────────────────
//  WP SECURITY RULES — Derived from wp-plugin-development skill (security.md)
// ─────────────────────────────────────────────────────────────────────────────

const WP_SECURITY_RULES = `
### WordPress Security Rules (apply to every PHP file)

Golden rule: **sanitize/validate on input — escape on output**.

#### Output escaping (by context)
- HTML text content → esc_html() or esc_html_e()
- HTML attribute values → esc_attr() or esc_attr_e()
- URL in href/src/action → esc_url()
- Rich/trusted HTML → wp_kses_post() (never echo raw HTML)
- JavaScript values → esc_js()
- Translation strings (HTML context) → esc_html__() / esc_html_e()

#### Input sanitization
- Text strings → sanitize_text_field( wp_unslash( $input ) )
- Integers → absint() or (int)
- Emails → sanitize_email()
- HTML content → wp_kses_post() or wp_kses()
- Always use wp_unslash() BEFORE sanitizing $_POST/$_GET values

#### Guard clauses (every PHP file)
- Start every PHP file (except index.php/front-page.php entry points) with:
  if ( ! defined( 'ABSPATH' ) ) { exit; }

#### Forms with side effects
- Any form that submits data (e.g., newsletter signup) must include wp_nonce_field()
- Verify nonce server-side with wp_verify_nonce() before processing
- Pair nonce checks with capability checks: current_user_can( 'capability' )

#### SQL (if used)
- Never interpolate user input into SQL; use $wpdb->prepare()
- Use specific $wpdb methods: get_results, get_var, insert, update, delete
`;

// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS — GIT (sandboxed)
// ═════════════════════════════════════════════════════════════════════════════

function gitInit(cwd: string): string {
  return execSafe("git init", cwd).stdout;
}

function gitAdd(cwd: string, pattern = "."): string {
  return execSafe(`git add ${pattern}`, cwd).stdout;
}

function gitCommit(
  cwd: string,
  message: string
): { stdout: string; success: boolean } {
  const safe = message.replace(/["`$\\]/g, "").slice(0, 200);
  return execSafe(`git commit -m "${safe}"`, cwd);
}

// ═════════════════════════════════════════════════════════════════════════════
//  LLM WRAPPER (Claude API — falls back to mock when no key)
// ═════════════════════════════════════════════════════════════════════════════

const USE_MOCK = !process.env.ANTHROPIC_API_KEY;

const LLM_SYSTEM =
  "You are a senior full-stack engineer. " +
  "Respond ONLY with valid JSON — no markdown fences, no explanations. " +
  "Return the raw JSON object or array directly.";

async function callLLM(prompt: string, maxTokens = 16384): Promise<unknown> {
  log("DEBUG", `LLM call (${USE_MOCK ? "MOCK" : "LIVE"}) — prompt ${prompt.length} chars, maxTokens ${maxTokens}`);
  if (USE_MOCK) return mockRouter(prompt);
  return claudeAPI(prompt, maxTokens);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claudeAPI(prompt: string, maxTokens = 16384): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";

  const MAX_API_RETRIES = 6;

  for (let apiAttempt = 1; apiAttempt <= MAX_API_RETRIES; apiAttempt++) {
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
          system: LLM_SYSTEM,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (fetchErr: unknown) {
      // Network-level errors: connection reset, DNS failure, timeout, etc.
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      if (apiAttempt < MAX_API_RETRIES) {
        const waitSec = 15 * apiAttempt;
        log("WARN", `Network error: ${msg}. Waiting ${waitSec}s before retry ${apiAttempt + 1}/${MAX_API_RETRIES}…`);
        await sleep(waitSec * 1000);
        continue;
      }
      throw new Error(`Network error after ${MAX_API_RETRIES} retries: ${msg}`);
    }

    // Handle rate limiting (429) and overloaded (529) with exponential backoff
    if (res.status === 429 || res.status === 529) {
      const retryAfter = res.headers.get("retry-after");
      const defaultWait = res.status === 529 ? 15 * (apiAttempt + 1) : 30 * apiAttempt;
      const waitSec = retryAfter ? parseInt(retryAfter, 10) : defaultWait;
      if (apiAttempt < MAX_API_RETRIES) {
        const reason = res.status === 429 ? "Rate limited" : "API overloaded";
        log("WARN", `${reason} (${res.status}). Waiting ${waitSec}s before retry ${apiAttempt + 1}/${MAX_API_RETRIES}…`);
        await sleep(waitSec * 1000);
        continue;
      }
      const body = await res.text();
      throw new Error(`API ${res.status} after ${MAX_API_RETRIES} retries: ${body.slice(0, 500)}`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Claude API ${res.status}: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      content?: { text?: string }[];
      stop_reason?: string;
    };
    const text = json.content?.[0]?.text ?? "";

    if (json.stop_reason === "max_tokens") {
      log("WARN", `Response truncated (hit max_tokens=${maxTokens}). Response length: ${text.length} chars`);
      throw new Error(
        `LLM response truncated at ${maxTokens} tokens. ` +
        `Try reducing batch size or increasing max_tokens.`
      );
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1].trim());

    const raw = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (raw) return JSON.parse(raw[1]);

    throw new Error(`No JSON in LLM response: ${text.slice(0, 300)}`);
  }

  throw new Error("Claude API: exhausted all retries");
}

// ═════════════════════════════════════════════════════════════════════════════
//  MOCK LLM — deterministic responses for offline testing
// ═════════════════════════════════════════════════════════════════════════════

function mockRouter(prompt: string): unknown {
  log("WARN", "Mock LLM active — set ANTHROPIC_API_KEY for real generation");
  if (prompt.includes("[ANALYZE_IDEA]")) return mockAnalysis(prompt);
  if (prompt.includes("[BUILD_SPEC]")) return mockSpec();
  if (prompt.includes("[GENERATE_CODE]")) return mockCodeGen(prompt);
  if (prompt.includes("[FIX_BUILD]")) return mockBuildFix();
  if (prompt.includes("[COMMIT_MSG]")) return mockCommitMsg();
  throw new Error("Mock LLM: unrecognised prompt tag");
}

/** Extract a human-readable brand name from a free-text idea string. */
function extractBrandName(idea: string): string {
  // Vietnamese: "tên thương hiệu là X" / "thương hiệu là X"
  let m = idea.match(/tên\s+thương\s+hiệu\s+(?:là\s+)?([^,."()\n]+)/i);
  if (m) return m[1].trim();

  m = idea.match(/thương\s+hiệu\s+(?:là\s+)?([^,."()\n]+)/i);
  if (m) return m[1].trim();

  // English: "brand name is X" / "called X" / "named X"
  m = idea.match(/brand(?:\s+name)?\s+(?:is\s+)?["']?([^,."'\n]+)["']?/i);
  if (m) return m[1].trim();

  m = idea.match(/(?:called|named)\s+["']?([^,."'\n]+)["']?/i);
  if (m) return m[1].trim();

  // Fall back: title-case the first 2 significant words of the idea
  const words = idea
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function mockAnalysis(prompt: string): FeatureAnalysis {
  const m = prompt.match(/Idea:\s*"([^"]+)"/);
  const idea = m?.[1] ?? "web application";
  const brandName = extractBrandName(idea);
  const slug = idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return {
    projectName: slug || "my-app",
    brandName,
    summary: `A modern landing page for ${brandName}: ${idea}`,
    targetAudience: `Customers interested in ${brandName}'s products, looking to browse and purchase online.`,
    goals: [
      `Establish ${brandName} as a trusted online brand`,
      "Drive product discovery and increase add-to-cart rate by 20%",
      "Reduce bounce rate with an engaging hero and clear CTA above the fold",
      "Grow newsletter subscriber base via footer signup",
    ],
    features: [
      {
        name: "Hero Section",
        description: "Full-width hero banner with background image, bold headline, subtitle, and primary CTA button",
        priority: "high",
        acceptanceCriteria: [
          "CTA button links to the featured products section",
          "Hero image covers the full viewport width at all breakpoints",
          "Headline and subtitle are editable via the WordPress Customizer",
        ],
      },
      {
        name: "Featured Products",
        description: "Responsive 4-column product listing cards with hover effects, product name, and price",
        priority: "high",
        acceptanceCriteria: [
          "Grid reflows to 2 columns on tablet and 1 column on mobile",
          "Each card displays image, name, and price with a hover zoom effect",
          "Product data is sourced from the static theme-data.php array",
        ],
      },
      {
        name: "Categories",
        description: "Visual category grid with overlay text and hover scale animation",
        priority: "high",
        acceptanceCriteria: [
          "Grid displays 4 categories in a row on desktop",
          "Each category card has an image, overlay gradient, and label",
          "Hover effect scales the image inside the card",
        ],
      },
      {
        name: "Editorial",
        description: "Featured article with split layout plus a 3-column article grid below",
        priority: "medium",
        acceptanceCriteria: [
          "Featured article shows a large image alongside headline, excerpt, and read-more link",
          "Article grid displays 3 cards with image, category tag, and title",
          "Section background uses the muted color token for contrast",
        ],
      },
      {
        name: "Archives Gallery",
        description: "Photo grid with hover overlay showing item name and season",
        priority: "medium",
        acceptanceCriteria: [
          "Grid shows 6 images in 3 columns on desktop",
          "Hover overlay fades in with item metadata",
          "A 'Load more' button is present below the grid",
        ],
      },
      {
        name: "About Section",
        description: "Brand story with split image/text layout and key stats",
        priority: "medium",
        acceptanceCriteria: [
          "Layout is 2-column on desktop and stacks on mobile",
          "Stats row displays at least 4 numeric metrics",
          "Section heading and body text are editable via Customizer",
        ],
      },
      {
        name: "Footer",
        description: "Multi-column footer with site navigation, social links, and newsletter signup form",
        priority: "low",
        acceptanceCriteria: [
          "Newsletter form includes an email input and submit button with a nonce",
          "Footer columns render the registered WordPress nav menu",
          "Footer includes copyright notice and legal links",
        ],
      },
    ],
    userStories: [
      { role: "visitor", goal: "I want to see an eye-catching hero immediately", rationale: `so that I understand what ${brandName} sells within 3 seconds` },
      { role: "shopper", goal: "I want to browse featured products in a clear grid", rationale: "so that I can quickly compare items and click through to a product" },
      { role: "shopper", goal: "I want to filter by category", rationale: "so that I can narrow down products to my needs" },
      { role: "returning customer", goal: "I want to read editorial articles", rationale: `so that I stay engaged with ${brandName} and discover new products` },
      { role: "visitor", goal: "I want to learn about the brand's story and values", rationale: "so that I can decide whether to trust and buy from them" },
      { role: "visitor", goal: "I want to sign up for the newsletter", rationale: "so that I receive new arrivals and promotions by email" },
    ],
    designDirection: {
      tone: "professional, trustworthy, modern",
      colorPalette: "deep navy (#0f172a) + electric indigo (#6366f1) + clean white (#f8fafc)",
      typography: "Heavy black-weight display font for headlines, clean medium-weight Inter for body text",
      inspiration: [`${brandName} brand identity`, "Modern e-commerce design"],
    },
    nonFunctionalRequirements: {
      performance: [
        "Page fully loaded under 2 seconds on a 4G connection",
        "All images are lazy-loaded with native loading='lazy'",
        "CSS and JS are minified and enqueued conditionally",
      ],
      accessibility: [
        "WCAG 2.1 AA compliance across all interactive elements",
        "Skip-to-content link present as the first focusable element",
        "All images have descriptive alt text; decorative images use alt=''",
      ],
      seo: [
        "Semantic HTML with correct heading hierarchy (single h1 per page)",
        "Meta description and OG tags manageable via WordPress SEO plugin",
        "Clean, human-readable URLs enforced via WordPress permalink settings",
      ],
    },
    contentRequirements: [
      "High-resolution hero background image (1920×1080)",
      "Product photography: at least 4 bike images in portrait format (600×800)",
      "Category thumbnails: 4 lifestyle images in landscape format (800×600)",
      "Editorial: 3–5 blog articles with cover images and body copy",
      "About section: brand story paragraph, logo, and 4 numeric key stats",
      "Archives: 6 gallery images (any aspect ratio, will be cropped to square)",
    ],
    techStack: {
      frontend: ["PHP", "WordPress", "CSS3", "Vanilla JS"],
      backend: ["WordPress", "PHP"],
      devtools: ["php", "wp-cli"],
    },
  };
}

function mockSpec(): ProjectSpec {
  return {
    architecture: "WordPress Theme with custom template parts, Customizer API, and vanilla CSS/JS",
    fileStructure: [
      { filePath: "style.css", description: "Theme styles with WordPress header comment" },
      { filePath: "functions.php", description: "Theme setup, enqueue, menus, customizer" },
      { filePath: "index.php", description: "Main fallback template" },
      { filePath: "front-page.php", description: "Front page composing all sections" },
      { filePath: "header.php", description: "Site header with nav" },
      { filePath: "footer.php", description: "Site footer" },
      { filePath: "page.php", description: "Generic page template" },
      { filePath: "404.php", description: "404 error page" },
      { filePath: "assets/css/animations.css", description: "Keyframe animations" },
      { filePath: "assets/js/main.js", description: "Frontend interactivity" },
      { filePath: "inc/customizer.php", description: "Customizer settings" },
      { filePath: "inc/theme-data.php", description: "Static data arrays" },
      { filePath: "template-parts/hero.php", description: "Hero section" },
      { filePath: "template-parts/featured-products.php", description: "Product grid" },
      { filePath: "template-parts/categories.php", description: "Category grid" },
      { filePath: "template-parts/editorial.php", description: "Editorial section" },
      { filePath: "template-parts/archives-gallery.php", description: "Archives gallery" },
      { filePath: "template-parts/about.php", description: "About section" },
      { filePath: "template-parts/back-to-top.php", description: "Back to top button" },
    ],
    apiEndpoints: [],
    buildScript: "php -l *.php inc/*.php template-parts/*.php",
    testScript: "php -l *.php inc/*.php template-parts/*.php",
  };
}

function mockCodeGen(prompt: string): GeneratedFile[] {
  // Extract brand context passed in the [GENERATE_CODE] prompt
  const projectMatch = prompt.match(/^Project slug\s*:\s*(.+)$/m) ?? prompt.match(/^Project:\s*(.+)$/m);
  const ideaMatch    = prompt.match(/^User's idea\s*:\s*"([^"]+)"/m);
  const brandMatch   = prompt.match(/^Brand name\s*:\s*(.+)$/m);
  const idea         = ideaMatch?.[1] ?? "";
  const rawSlug      = projectMatch?.[1]?.trim() ?? "my-brand";
  const brandName    = brandMatch?.[1]?.trim() || (idea ? extractBrandName(idea) : "My Brand");

  // Derive safe identifiers from brand name
  const slug    = rawSlug;
  const prefix  = slug.replace(/-/g, "_");   // e.g. hoang_long_pin
  const domain  = slug;                       // text domain

  /** Replace every hardcoded "Premium Bikes" reference with the real brand */
  const brand = (s: string) =>
    s
      .replace(/Premium Bikes/g, brandName)
      .replace(/premium-bikes/g, slug)
      .replace(/premium_bikes/g, prefix)
      .replace(/premium-bikes/g, domain);

  const files: GeneratedFile[] = [
    {
      filePath: "style.css",
      content: [
        "/*",
        "Theme Name: Premium Bikes",
        "Theme URI: https://example.com/premium-bikes",
        "Author: AI Agent",
        "Author URI: https://example.com",
        "Description: A curated collection of high-performance products for every customer.",
        "Version: 1.0.0",
        "License: GNU General Public License v2 or later",
        "License URI: https://www.gnu.org/licenses/gpl-2.0.html",
        "Text Domain: premium-bikes",
        "Tags: landing-page, custom-menu, custom-logo, featured-images",
        "*/",
        "",
        "/* CSS Custom Properties */",
        ":root {",
        "  --color-primary: #0ea5e9;",
        "  --color-primary-foreground: #ffffff;",
        "  --color-secondary: #22c55e;",
        "  --color-secondary-foreground: #ffffff;",
        "  --color-background: #ffffff;",
        "  --color-foreground: #0f172a;",
        "  --color-muted: #f8fafc;",
        "  --color-muted-foreground: #64748b;",
        "  --color-card: #ffffff;",
        "  --color-card-foreground: #0f172a;",
        "  --color-border: #e2e8f0;",
        "  --color-accent: #f59e0b;",
        "  --color-accent-foreground: #ffffff;",
        "  ",
        "  --color-dark: #1e293b;",
        "  --color-light: #f1f5f9;",
        "  ",
        "  /* Spacing Scale */",
        "  --space-xs: 0.5rem;",
        "  --space-sm: 1rem;",
        "  --space-md: 1.5rem;",
        "  --space-lg: 2rem;",
        "  --space-xl: 3rem;",
        "  --space-2xl: 4rem;",
        "  --space-3xl: 6rem;",
        "  ",
        "  /* Typography Scale */",
        "  --text-xs: 0.75rem;",
        "  --text-sm: 0.875rem;",
        "  --text-base: 1rem;",
        "  --text-lg: 1.125rem;",
        "  --text-xl: 1.25rem;",
        "  --text-2xl: 1.5rem;",
        "  --text-3xl: 1.875rem;",
        "  --text-4xl: 2.25rem;",
        "  --text-5xl: 3rem;",
        "  --text-6xl: 3.75rem;",
        "  ",
        "  /* Shadow Scale */",
        "  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);",
        "  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);",
        "  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);",
        "  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);",
        "  ",
        "  /* Border Radius */",
        "  --radius-sm: 0.25rem;",
        "  --radius-md: 0.5rem;",
        "  --radius-lg: 0.75rem;",
        "  --radius-xl: 1rem;",
        "  --radius-full: 9999px;",
        "}",
        "",
        "/* CSS Reset */",
        "*, *::before, *::after {",
        "  box-sizing: border-box;",
        "  margin: 0;",
        "  padding: 0;",
        "}",
        "",
        "html {",
        "  scroll-behavior: smooth;",
        "  font-size: 16px;",
        "}",
        "",
        "body {",
        "  background-color: var(--color-background);",
        "  color: var(--color-foreground);",
        "  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;",
        "  -webkit-font-smoothing: antialiased;",
        "  -moz-osx-font-smoothing: grayscale;",
        "  line-height: 1.6;",
        "  font-weight: 400;",
        "}",
        "",
        "img {",
        "  max-width: 100%;",
        "  height: auto;",
        "  display: block;",
        "}",
        "",
        "a {",
        "  text-decoration: none;",
        "  color: inherit;",
        "  transition: all 0.2s ease;",
        "}",
        "",
        "a:hover {",
        "  color: var(--color-primary);",
        "}",
        "",
        "h1, h2, h3, h4, h5, h6 {",
        "  font-weight: 700;",
        "  line-height: 1.2;",
        "  margin-bottom: var(--space-sm);",
        "}",
        "",
        "h1 {",
        "  font-size: var(--text-4xl);",
        "  font-weight: 900;",
        "}",
        "",
        "h2 {",
        "  font-size: var(--text-3xl);",
        "  font-weight: 800;",
        "}",
        "",
        "h3 {",
        "  font-size: var(--text-2xl);",
        "  font-weight: 700;",
        "}",
        "",
        "h4 {",
        "  font-size: var(--text-xl);",
        "  font-weight: 600;",
        "}",
        "",
        "p {",
        "  margin-bottom: var(--space-md);",
        "}",
        "",
        "/* Container */",
        ".container {",
        "  max-width: 1280px;",
        "  margin: 0 auto;",
        "  padding: 0 var(--space-sm);",
        "}",
        "",
        "@media (min-width: 768px) {",
        "  .container {",
        "    padding: 0 var(--space-lg);",
        "  }",
        "}",
        "",
        "@media (min-width: 1024px) {",
        "  .container {",
        "    padding: 0 var(--space-2xl);",
        "  }",
        "}",
        "",
        "/* Skip-to-content link */",
        ".skip-to-content {",
        "  position: absolute;",
        "  top: -40px;",
        "  left: 0;",
        "  background: var(--color-primary);",
        "  color: var(--color-primary-foreground);",
        "  padding: var(--space-xs) var(--space-sm);",
        "  z-index: 100;",
        "  border-radius: 0 0 var(--radius-sm) 0;",
        "  font-weight: 600;",
        "  transition: top 0.2s ease;",
        "}",
        "",
        ".skip-to-content:focus {",
        "  top: 0;",
        "}",
        "",
        "/* Glass Effect */",
        ".glass {",
        "  background-color: rgba(255, 255, 255, 0.8);",
        "  backdrop-filter: blur(24px);",
        "  -webkit-backdrop-filter: blur(24px);",
        "  border: 1px solid rgba(255, 255, 255, 0.2);",
        "}",
        "",
        ".glass-dark {",
        "  background-color: rgba(30, 41, 59, 0.8);",
        "  backdrop-filter: blur(24px);",
        "  -webkit-backdrop-filter: blur(24px);",
        "  border: 1px solid rgba(255, 255, 255, 0.1);",
        "  color: var(--color-primary-foreground);",
        "}",
        "",
        "/* Button Styles */",
        ".btn {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  padding: var(--space-sm) var(--space-md);",
        "  border-radius: var(--radius-md);",
        "  font-weight: 600;",
        "  font-size: var(--text-base);",
        "  border: none;",
        "  cursor: pointer;",
        "  text-decoration: none;",
        "  transition: all 0.3s ease;",
        "  position: relative;",
        "  overflow: hidden;",
        "}",
        "",
        ".btn:focus-visible {",
        "  outline: 3px solid var(--color-primary);",
        "  outline-offset: 2px;",
        "}",
        "",
        ".btn-primary {",
        "  background-color: var(--color-primary);",
        "  color: var(--color-primary-foreground);",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .btn-primary:hover {",
        "    background-color: var(--color-electric-blue);",
        "    transform: translateY(-2px);",
        "    box-shadow: var(--shadow-lg);",
        "  }",
        "}",
        "",
        ".btn-secondary {",
        "  background-color: var(--color-secondary);",
        "  color: var(--color-secondary-foreground);",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .btn-secondary:hover {",
        "    background-color: var(--color-secondary);",
        "    transform: translateY(-2px);",
        "    box-shadow: var(--shadow-lg);",
        "  }",
        "}",
        "",
        ".btn-outline {",
        "  border: 2px solid var(--color-primary);",
        "  background: transparent;",
        "  color: var(--color-primary);",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .btn-outline:hover {",
        "    background-color: var(--color-primary);",
        "    color: var(--color-primary-foreground);",
        "    transform: translateY(-2px);",
        "    box-shadow: var(--shadow-lg);",
        "  }",
        "}",
        "",
        ".btn-ghost {",
        "  background: transparent;",
        "  color: var(--color-foreground);",
        "  border: 1px solid var(--color-border);",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .btn-ghost:hover {",
        "    background-color: var(--color-muted);",
        "    border-color: var(--color-primary);",
        "  }",
        "}",
        "",
        ".btn-lg {",
        "  padding: var(--space-md) var(--space-xl);",
        "  font-size: var(--text-lg);",
        "}",
        "",
        ".btn-sm {",
        "  padding: var(--space-xs) var(--space-sm);",
        "  font-size: var(--text-sm);",
        "}",
        "",
        "/* Card Styles */",
        ".card {",
        "  background-color: var(--color-card);",
        "  border: 1px solid var(--color-border);",
        "  border-radius: var(--radius-lg);",
        "  padding: var(--space-lg);",
        "  box-shadow: var(--shadow-sm);",
        "  transition: all 0.3s ease;",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .card:hover {",
        "    transform: translateY(-4px);",
        "    box-shadow: var(--shadow-lg);",
        "  }",
        "}",
        "",
        ".card-elevated {",
        "  box-shadow: var(--shadow-md);",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .card-elevated:hover {",
        "    transform: translateY(-6px);",
        "    box-shadow: var(--shadow-xl);",
        "  }",
        "}",
        "",
        "/* Grid System */",
        ".grid {",
        "  display: grid;",
        "  gap: var(--space-lg);",
        "}",
        "",
        ".grid-cols-1 {",
        "  grid-template-columns: repeat(1, 1fr);",
        "}",
        "",
        ".grid-cols-2 {",
        "  grid-template-columns: repeat(2, 1fr);",
        "}",
        "",
        ".grid-cols-3 {",
        "  grid-template-columns: repeat(3, 1fr);",
        "}",
        "",
        ".grid-cols-4 {",
        "  grid-template-columns: repeat(4, 1fr);",
        "}",
        "",
        "@media (max-width: 768px) {",
        "  .grid-cols-2,",
        "  .grid-cols-3,",
        "  .grid-cols-4 {",
        "    grid-template-columns: 1fr;",
        "  }",
        "}",
        "",
        "@media (min-width: 768px) and (max-width: 1024px) {",
        "  .grid-cols-3,",
        "  .grid-cols-4 {",
        "    grid-template-columns: repeat(2, 1fr);",
        "  }",
        "}",
        "",
        "@media (min-width: 1024px) {",
        "  .grid-cols-4 {",
        "    grid-template-columns: repeat(3, 1fr);",
        "  }",
        "}",
        "",
        "@media (min-width: 1280px) {",
        "  .grid-cols-4 {",
        "    grid-template-columns: repeat(4, 1fr);",
        "  }",
        "}",
        "",
        "/* Flex Utilities */",
        ".flex {",
        "  display: flex;",
        "}",
        "",
        ".flex-col {",
        "  flex-direction: column;",
        "}",
        "",
        ".items-center {",
        "  align-items: center;",
        "}",
        "",
        ".justify-center {",
        "  justify-content: center;",
        "}",
        "",
        ".justify-between {",
        "  justify-content: space-between;",
        "}",
        "",
        ".gap-sm {",
        "  gap: var(--space-sm);",
        "}",
        "",
        ".gap-md {",
        "  gap: var(--space-md);",
        "}",
        "",
        ".gap-lg {",
        "  gap: var(--space-lg);",
        "}",
        "",
        "/* Text Utilities */",
        ".text-center {",
        "  text-align: center;",
        "}",
        "",
        ".text-left {",
        "  text-align: left;",
        "}",
        "",
        ".text-right {",
        "  text-align: right;",
        "}",
        "",
        ".text-sm {",
        "  font-size: var(--text-sm);",
        "}",
        "",
        ".text-lg {",
        "  font-size: var(--text-lg);",
        "}",
        "",
        ".text-xl {",
        "  font-size: var(--text-xl);",
        "}",
        "",
        ".text-2xl {",
        "  font-size: var(--text-2xl);",
        "}",
        "",
        ".text-muted {",
        "  color: var(--color-muted-foreground);",
        "}",
        "",
        ".text-primary {",
        "  color: var(--color-primary);",
        "}",
        "",
        ".font-medium {",
        "  font-weight: 500;",
        "}",
        "",
        ".font-semibold {",
        "  font-weight: 600;",
        "}",
        "",
        ".font-bold {",
        "  font-weight: 700;",
        "}",
        "",
        "/* Spacing Utilities */",
        ".p-0 { padding: 0; }",
        ".p-sm { padding: var(--space-sm); }",
        ".p-md { padding: var(--space-md); }",
        ".p-lg { padding: var(--space-lg); }",
        ".p-xl { padding: var(--space-xl); }",
        "",
        ".py-0 { padding-top: 0; padding-bottom: 0; }",
        ".py-sm { padding-top: var(--space-sm); padding-bottom: var(--space-sm); }",
        ".py-md { padding-top: var(--space-md); padding-bottom: var(--space-md); }",
        ".py-lg { padding-top: var(--space-lg); padding-bottom: var(--space-lg); }",
        ".py-xl { padding-top: var(--space-xl); padding-bottom: var(--space-xl); }",
        ".py-2xl { padding-top: var(--space-2xl); padding-bottom: var(--space-2xl); }",
        ".py-3xl { padding-top: var(--space-3xl); padding-bottom: var(--space-3xl); }",
        "",
        ".px-0 { padding-left: 0; padding-right: 0; }",
        ".px-sm { padding-left: var(--space-sm); padding-right: var(--space-sm); }",
        ".px-md { padding-left: var(--space-md); padding-right: var(--space-md); }",
        ".px-lg { padding-left: var(--space-lg); padding-right: var(--space-lg); }",
        ".px-xl { padding-left: var(--space-xl); padding-right: var(--space-xl); }",
        "",
        ".m-0 { margin: 0; }",
        ".mb-sm { margin-bottom: var(--space-sm); }",
        ".mb-md { margin-bottom: var(--space-md); }",
        ".mb-lg { margin-bottom: var(--space-lg); }",
        ".mb-xl { margin-bottom: var(--space-xl); }",
        ".mb-2xl { margin-bottom: var(--space-2xl); }",
        "",
        "/* Section Styles */",
        ".section {",
        "  padding: var(--space-2xl) 0;",
        "}",
        "",
        "@media (min-width: 768px) {",
        "  .section {",
        "    padding: var(--space-3xl) 0;",
        "  }",
        "}",
        "",
        ".section-hero {",
        "  min-height: 100vh;",
        "  display: flex;",
        "  align-items: center;",
        "  position: relative;",
        "  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-electric-blue) 50%, var(--color-tech-purple) 100%);",
        "  overflow: hidden;",
        "}",
        "",
        ".section-hero::before {",
        "  content: '';",
        "  position: absolute;",
        "  top: 0;",
        "  left: 0;",
        "  right: 0;",
        "  bottom: 0;",
        "  background: rgba(0, 0, 0, 0.3);",
        "  z-index: 1;",
        "}",
        "",
        ".section-hero > * {",
        "  position: relative;",
        "  z-index: 2;",
        "}",
        "",
        ".section-hero__content {",
        "  text-align: center;",
        "  color: var(--color-primary-foreground);",
        "  max-width: 800px;",
        "  margin: 0 auto;",
        "}",
        "",
        ".section-hero__title {",
        "  font-size: var(--text-4xl);",
        "  font-weight: 900;",
        "  margin-bottom: var(--space-lg);",
        "  line-height: 1.1;",
        "}",
        "",
        "@media (min-width: 768px) {",
        "  .section-hero__title {",
        "    font-size: var(--text-5xl);",
        "  }",
        "}",
        "",
        "@media (min-width: 1024px) {",
        "  .section-hero__title {",
        "    font-size: var(--text-6xl);",
        "  }",
        "}",
        "",
        ".section-hero__subtitle {",
        "  font-size: var(--text-lg);",
        "  font-weight: 400;",
        "  margin-bottom: var(--space-xl);",
        "  opacity: 0.9;",
        "}",
        "",
        "@media (min-width: 768px) {",
        "  .section-hero__subtitle {",
        "    font-size: var(--text-xl);",
        "  }",
        "}",
        "",
        "/* Product Card */",
        ".product-card {",
        "  background: var(--color-card);",
        "  border-radius: var(--radius-lg);",
        "  overflow: hidden;",
        "  box-shadow: var(--shadow-md);",
        "  transition: all 0.3s ease;",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .product-card:hover {",
        "    transform: translateY(-6px);",
        "    box-shadow: var(--shadow-xl);",
        "  }",
        "}",
        "",
        ".product-card__image {",
        "  width: 100%;",
        "  height: 250px;",
        "  object-fit: cover;",
        "  transition: transform 0.3s ease;",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .product-card:hover .product-card__image {",
        "    transform: scale(1.05);",
        "  }",
        "}",
        "",
        ".product-card__content {",
        "  padding: var(--space-lg);",
        "}",
        "",
        ".product-card__title {",
        "  font-size: var(--text-xl);",
        "  font-weight: 700;",
        "  margin-bottom: var(--space-sm);",
        "}",
        "",
        ".product-card__description {",
        "  color: var(--color-muted-foreground);",
        "  margin-bottom: var(--space-md);",
        "  font-size: var(--text-sm);",
        "}",
        "",
        ".product-card__price {",
        "  font-size: var(--text-lg);",
        "  font-weight: 700;",
        "  color: var(--color-primary);",
        "  margin-bottom: var(--space-md);",
        "}",
        "",
        "/* Category Card */",
        ".category-card {",
        "  position: relative;",
        "  height: 300px;",
        "  border-radius: var(--radius-lg);",
        "  overflow: hidden;",
        "  cursor: pointer;",
        "  transition: transform 0.3s ease;",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .category-card:hover {",
        "    transform: scale(1.02);",
        "  }",
        "}",
        "",
        ".category-card__image {",
        "  width: 100%;",
        "  height: 100%;",
        "  object-fit: cover;",
        "  transition: transform 0.3s ease;",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .category-card:hover .category-card__image {",
        "    transform: scale(1.1);",
        "  }",
        "}",
        "",
        ".category-card__overlay {",
        "  position: absolute;",
        "  top: 0;",
        "  left: 0;",
        "  right: 0;",
        "  bottom: 0;",
        "  background: linear-gradient(45deg, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.3));",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  color: white;",
        "  text-align: center;",
        "  transition: background 0.3s ease;",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .category-card:hover .category-card__overlay {",
        "    background: linear-gradient(45deg, rgba(14, 165, 233, 0.8), rgba(59, 130, 246, 0.6));",
        "  }",
        "}",
        "",
        ".category-card__title {",
        "  font-size: var(--text-2xl);",
        "  font-weight: 800;",
        "  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);",
        "}",
        "",
        "/* Article Card */",
        ".article-card {",
        "  background: var(--color-card);",
        "  border-radius: var(--radius-lg);",
        "  overflow: hidden;",
        "  box-shadow: var(--shadow-sm);",
        "  transition: all 0.3s ease;",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .article-card:hover {",
        "    transform: translateY(-4px);",
        "    box-shadow: var(--shadow-lg);",
        "  }",
        "}",
        "",
        ".article-card__image {",
        "  width: 100%;",
        "  height: 200px;",
        "  object-fit: cover;",
        "}",
        "",
        ".article-card__content {",
        "  padding: var(--space-lg);",
        "}",
        "",
        ".article-card__category {",
        "  display: inline-block;",
        "  background: var(--color-primary);",
        "  color: var(--color-primary-foreground);",
        "  padding: var(--space-xs) var(--space-sm);",
        "  border-radius: var(--radius-full);",
        "  font-size: var(--text-xs);",
        "  font-weight: 600;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.05em;",
        "  margin-bottom: var(--space-sm);",
        "}",
        "",
        ".article-card__title {",
        "  font-size: var(--text-lg);",
        "  font-weight: 600;",
        "  margin-bottom: var(--space-sm);",
        "  line-height: 1.3;",
        "}",
        "",
        ".article-card__excerpt {",
        "  color: var(--color-muted-foreground);",
        "  font-size: var(--text-sm);",
        "  margin-bottom: var(--space-md);",
        "}",
        "",
        ".article-card__meta {",
        "  font-size: var(--text-xs);",
        "  color: var(--color-muted-foreground);",
        "}",
        "",
        "/* Header Styles */",
        ".site-header {",
        "  position: fixed;",
        "  top: 0;",
        "  left: 0;",
        "  right: 0;",
        "  z-index: 50;",
        "  transition: all 0.3s ease;",
        "}",
        "",
        ".site-header--scrolled {",
        "  background-color: rgba(255, 255, 255, 0.95);",
        "  backdrop-filter: blur(20px);",
        "  -webkit-backdrop-filter: blur(20px);",
        "  border-bottom: 1px solid var(--color-border);",
        "  box-shadow: var(--shadow-sm);",
        "}",
        "",
        ".header-nav {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  padding: var(--space-md) 0;",
        "}",
        "",
        ".site-logo {",
        "  font-size: var(--text-2xl);",
        "  font-weight: 800;",
        "  color: var(--color-primary);",
        "  display: flex;",
        "  align-items: center;",
        "  gap: var(--space-sm);",
        "}",
        "",
        ".nav-menu {",
        "  display: none;",
        "  list-style: none;",
        "  gap: var(--space-xl);",
        "}",
        "",
        "@media (min-width: 768px) {",
        "  .nav-menu {",
        "    display: flex;",
        "  }",
        "}",
        "",
        ".nav-menu a {",
        "  font-weight: 500;",
        "  transition: color 0.2s ease;",
        "}",
        "",
        ".nav-menu a:hover,",
        ".nav-menu a:focus-visible {",
        "  color: var(--color-primary);",
        "  outline: none;",
        "}",
        "",
        ".nav-menu a:focus-visible {",
        "  text-decoration: underline;",
        "  text-decoration-color: var(--color-primary);",
        "}",
        "",
        "/* Footer Styles */",
        ".site-footer {",
        "  background: var(--color-dark);",
        "  color: var(--color-light);",
        "  padding: var(--space-3xl) 0 var(--space-lg) 0;",
        "}",
        "",
        ".footer-content {",
        "  display: grid;",
        "  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));",
        "  gap: var(--space-xl);",
        "  margin-bottom: var(--space-xl);",
        "}",
        "",
        ".footer-section h3 {",
        "  color: var(--color-primary);",
        "  margin-bottom: var(--space-md);",
        "}",
        "",
        ".footer-section ul {",
        "  list-style: none;",
        "}",
        "",
        ".footer-section ul li {",
        "  margin-bottom: var(--space-sm);",
        "}",
        "",
        ".footer-section a {",
        "  color: var(--color-light);",
        "  opacity: 0.8;",
        "  transition: opacity 0.2s ease;",
        "}",
        "",
        ".footer-section a:hover,",
        ".footer-section a:focus-visible {",
        "  opacity: 1;",
        "  color: var(--color-primary);",
        "  outline: none;",
        "}",
        "",
        ".footer-bottom {",
        "  border-top: 1px solid rgba(255, 255, 255, 0.1);",
        "  padding-top: var(--space-lg);",
        "  text-align: center;",
        "  opacity: 0.7;",
        "  font-size: var(--text-sm);",
        "}",
        "",
        "/* Back to Top Button */",
        ".back-to-top {",
        "  position: fixed;",
        "  bottom: var(--space-lg);",
        "  right: var(--space-lg);",
        "  width: 50px;",
        "  height: 50px;",
        "  background: var(--color-primary);",
        "  color: var(--color-primary-foreground);",
        "  border: none;",
        "  border-radius: var(--radius-full);",
        "  cursor: pointer;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  box-shadow: var(--shadow-lg);",
        "  transition: all 0.3s ease;",
        "  opacity: 0;",
        "  visibility: hidden;",
        "  z-index: 40;",
        "}",
        "",
        ".back-to-top.show {",
        "  opacity: 1;",
        "  visibility: visible;",
        "}",
        "",
        "@media (prefers-reduced-motion: no-preference) {",
        "  .back-to-top:hover {",
        "    transform: translateY(-2px);",
        "    box-shadow: var(--shadow-xl);",
        "    background: var(--color-electric-blue);",
        "  }",
        "}",
        "",
        ".back-to-top:focus-visible {",
        "  outline: 3px solid var(--color-primary);",
        "  outline-offset: 2px;",
        "}",
        "",
        "/* Reduced Motion Support */",
        "@media (prefers-reduced-motion: reduce) {",
        "  *,",
        "  *::before,",
        "  *::after {",
        "    animation-duration: 0.01ms !important;",
        "    animation-iteration-count: 1 !important;",
        "    transition-duration: 0.01ms !important;",
        "    scroll-behavior: auto !important;",
        "  }",
        "  ",
        "  .back-to-top,",
        "  .product-card,",
        "  .category-card,",
        "  .article-card,",
        "  .card,",
        "  .btn {",
        "    transform: none !important;",
        "  }",
        "}",
        "",
        "/* Responsive Typography */",
        "@media (min-width: 768px) {",
        "  :root {",
        "    --text-4xl: 2.5rem;",
        "    --text-5xl: 3.5rem;",
        "    --text-6xl: 4.5rem;",
        "  }",
        "}",
        "",
        "@media (min-width: 1024px) {",
        "  :root {",
        "    --text-4xl: 3rem;",
        "    --text-5xl: 4rem;",
        "    --text-6xl: 5rem;",
        "  }",
        "}",
        "",
        "/* ═══════════════════════════════════════════",
        "   HEADER — BEM layout fix",
        "   ═══════════════════════════════════════════ */",
        ".site-header {",
        "  background: rgba(255, 255, 255, 0.0);",
        "  padding: 0;",
        "}",
        "",
        ".site-header--scrolled,",
        ".site-header.scrolled,",
        ".site-header.is-scrolled {",
        "  background: rgba(255, 255, 255, 0.95);",
        "  backdrop-filter: blur(20px);",
        "  -webkit-backdrop-filter: blur(20px);",
        "  box-shadow: var(--shadow-sm);",
        "  border-bottom: 1px solid var(--color-border);",
        "}",
        "",
        ".site-header__container {",
        "  /* inherits from .container */",
        "}",
        "",
        ".site-header__inner {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  gap: var(--space-lg);",
        "  padding: var(--space-md) 0;",
        "}",
        "",
        "/* Branding */",
        ".site-header__branding {",
        "  flex-shrink: 0;",
        "}",
        "",
        ".site-header__logo-text {",
        "  display: flex;",
        "  flex-direction: column;",
        "  line-height: 1.2;",
        "  gap: 2px;",
        "}",
        "",
        ".site-header__brand-name {",
        "  font-size: var(--text-xl);",
        "  font-weight: 800;",
        "  color: var(--color-foreground);",
        "  white-space: nowrap;",
        "}",
        "",
        ".site-header--scrolled .site-header__brand-name,",
        ".site-header.is-scrolled .site-header__brand-name,",
        ".site-header.scrolled .site-header__brand-name {",
        "  color: var(--color-primary);",
        "}",
        "",
        "/* On hero (transparent header) — white text */",
        ".site-header:not(.site-header--scrolled):not(.scrolled):not(.is-scrolled) .site-header__brand-name {",
        "  color: #ffffff;",
        "}",
        "",
        ".site-header__tagline {",
        "  font-size: var(--text-xs);",
        "  font-weight: 500;",
        "  color: rgba(255, 255, 255, 0.7);",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.08em;",
        "}",
        "",
        ".site-header--scrolled .site-header__tagline,",
        ".site-header.is-scrolled .site-header__tagline,",
        ".site-header.scrolled .site-header__tagline {",
        "  color: var(--color-muted-foreground);",
        "}",
        "",
        "/* Navigation */",
        ".site-header__navigation {",
        "  flex: 1;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "}",
        "",
        "/* WordPress renders nav as <ul class=\"site-header__menu\"> */",
        ".site-header__menu {",
        "  display: none;",
        "  list-style: none;",
        "  align-items: center;",
        "  gap: var(--space-xl);",
        "  margin: 0;",
        "  padding: 0;",
        "}",
        "",
        "@media (min-width: 768px) {",
        "  .site-header__menu {",
        "    display: flex;",
        "  }",
        "}",
        "",
        ".site-header__menu li {",
        "  position: relative;",
        "}",
        "",
        ".site-header__menu a {",
        "  font-size: var(--text-sm);",
        "  font-weight: 600;",
        "  color: rgba(255, 255, 255, 0.9);",
        "  transition: color 0.2s ease;",
        "  padding: var(--space-xs) 0;",
        "  white-space: nowrap;",
        "}",
        "",
        ".site-header__menu a:hover {",
        "  color: #ffffff;",
        "}",
        "",
        ".site-header--scrolled .site-header__menu a,",
        ".site-header.is-scrolled .site-header__menu a,",
        ".site-header.scrolled .site-header__menu a {",
        "  color: var(--color-muted-foreground);",
        "}",
        "",
        ".site-header--scrolled .site-header__menu a:hover,",
        ".site-header.is-scrolled .site-header__menu a:hover,",
        ".site-header.scrolled .site-header__menu a:hover {",
        "  color: var(--color-primary);",
        "}",
        "",
        "/* Hamburger toggle */",
        ".site-header__menu-toggle {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  background: none;",
        "  border: 1px solid rgba(255, 255, 255, 0.3);",
        "  border-radius: var(--radius-md);",
        "  padding: var(--space-xs) var(--space-sm);",
        "  cursor: pointer;",
        "  color: #ffffff;",
        "  font-size: var(--text-sm);",
        "  font-weight: 600;",
        "}",
        "",
        ".site-header--scrolled .site-header__menu-toggle,",
        ".site-header.is-scrolled .site-header__menu-toggle,",
        ".site-header.scrolled .site-header__menu-toggle {",
        "  border-color: var(--color-border);",
        "  color: var(--color-foreground);",
        "}",
        "",
        "@media (min-width: 768px) {",
        "  .site-header__menu-toggle {",
        "    display: none;",
        "  }",
        "}",
        "",
        ".site-header__menu-icon {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 4px;",
        "  width: 18px;",
        "}",
        "",
        ".site-header__menu-icon span {",
        "  display: block;",
        "  height: 2px;",
        "  background: currentColor;",
        "  border-radius: 2px;",
        "  transition: all 0.3s ease;",
        "}",
        "",
        ".site-header__menu-text {",
        "  font-size: var(--text-xs);",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.05em;",
        "}",
        "",
        "/* Actions */",
        ".site-header__actions {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: var(--space-md);",
        "  flex-shrink: 0;",
        "}",
        "",
        ".site-header__phone {",
        "  display: none;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  font-size: var(--text-sm);",
        "  font-weight: 600;",
        "  color: rgba(255, 255, 255, 0.9);",
        "  white-space: nowrap;",
        "}",
        "",
        "@media (min-width: 640px) {",
        "  .site-header__phone {",
        "    display: flex;",
        "  }",
        "}",
        "",
        ".site-header--scrolled .site-header__phone,",
        ".site-header.is-scrolled .site-header__phone,",
        ".site-header.scrolled .site-header__phone {",
        "  color: var(--color-foreground);",
        "}",
        "",
        ".site-header__phone-text {",
        "  font-size: var(--text-sm);",
        "}",
        "",
        ".site-header__cta {",
        "  /* inherits .btn-primary */",
        "  padding: 0.6rem 1.2rem;",
        "  font-size: var(--text-sm);",
        "  white-space: nowrap;",
        "}",
        "",
        "/* ═══════════════════════════════════════════",
        "   HERO — BEM layout fix",
        "   ═══════════════════════════════════════════ */",
        ".section-hero {",
        "  padding-top: 0;",
        "  background-size: cover;",
        "  background-position: center;",
        "  background-repeat: no-repeat;",
        "}",
        "",
        ".section-hero__overlay {",
        "  position: absolute;",
        "  inset: 0;",
        "  background: linear-gradient(",
        "    150deg,",
        "    rgba(59, 130, 246, 0.62) 0%,",
        "    rgba(37, 99, 235, 0.54) 50%,",
        "    rgba(6, 182, 212, 0.48) 100%",
        "  );",
        "  z-index: 1;",
        "}",
        "",
        "/* Reset the ::before overlay since we have a real div now */",
        ".section-hero::before {",
        "  display: none;",
        "}",
        "",
        ".section-hero .container {",
        "  position: relative;",
        "  z-index: 2;",
        "  width: 100%;",
        "  padding-top: 7rem;   /* clear fixed header */",
        "  padding-bottom: 5rem;",
        "}",
        "",
        ".section-hero__content {",
        "  /* full-width wrapper */",
        "}",
        "",
        ".section-hero__text {",
        "  max-width: 780px;",
        "  margin: 0 auto;",
        "  text-align: center;",
        "  color: #ffffff;",
        "}",
        "",
        "/* Badge */",
        ".section-hero__badge {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  background: rgba(255, 255, 255, 0.2);",
        "  backdrop-filter: blur(8px);",
        "  border: 1px solid rgba(255, 255, 255, 0.3);",
        "  border-radius: var(--radius-full);",
        "  padding: 0.4rem 1rem;",
        "  font-size: var(--text-sm);",
        "  font-weight: 600;",
        "  color: #ffffff;",
        "  margin-bottom: var(--space-lg);",
        "}",
        "",
        ".section-hero__badge-icon {",
        "  display: flex;",
        "  align-items: center;",
        "  color: var(--color-energy-yellow);",
        "}",
        "",
        "/* Title override */",
        ".section-hero__title {",
        "  color: #ffffff;",
        "  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.2);",
        "  margin-bottom: var(--space-md);",
        "}",
        "",
        "/* Subtitle */",
        ".section-hero__subtitle {",
        "  font-size: var(--text-xl);",
        "  color: rgba(255, 255, 255, 0.9);",
        "  font-weight: 500;",
        "  margin-bottom: var(--space-md);",
        "  line-height: 1.5;",
        "}",
        "",
        "/* Description */",
        ".section-hero__description {",
        "  font-size: var(--text-base);",
        "  color: rgba(255, 255, 255, 0.8);",
        "  max-width: 600px;",
        "  margin: 0 auto var(--space-xl) auto;",
        "  line-height: 1.75;",
        "}",
        "",
        "/* Features row */",
        ".section-hero__features {",
        "  display: flex;",
        "  flex-wrap: wrap;",
        "  gap: var(--space-md);",
        "  justify-content: center;",
        "  margin-bottom: var(--space-xl);",
        "}",
        "",
        ".section-hero__feature {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  background: rgba(255, 255, 255, 0.15);",
        "  backdrop-filter: blur(6px);",
        "  border-radius: var(--radius-full);",
        "  padding: 0.4rem 0.9rem;",
        "  font-size: var(--text-sm);",
        "  font-weight: 600;",
        "  color: #ffffff;",
        "  white-space: nowrap;",
        "}",
        "",
        ".section-hero__feature-icon {",
        "  display: flex;",
        "  align-items: center;",
        "  flex-shrink: 0;",
        "}",
        "",
        "/* CTA buttons */",
        ".section-hero__actions {",
        "  display: flex;",
        "  flex-wrap: wrap;",
        "  gap: var(--space-md);",
        "  justify-content: center;",
        "}",
        "",
        ".section-hero__cta-primary {",
        "  background: #ffffff;",
        "  color: var(--color-primary);",
        "  font-weight: 700;",
        "  padding: 0.9rem 2rem;",
        "  font-size: var(--text-base);",
        "  border-radius: var(--radius-md);",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  transition: all 0.3s ease;",
        "  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);",
        "}",
        "",
        ".section-hero__cta-primary:hover {",
        "  background: var(--color-primary);",
        "  color: #ffffff;",
        "  transform: translateY(-2px);",
        "  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);",
        "}",
        "",
        ".section-hero__cta-secondary {",
        "  background: transparent;",
        "  color: #ffffff;",
        "  font-weight: 700;",
        "  padding: 0.9rem 2rem;",
        "  font-size: var(--text-base);",
        "  border-radius: var(--radius-md);",
        "  border: 2px solid rgba(255, 255, 255, 0.6);",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  transition: all 0.3s ease;",
        "}",
        "",
        ".section-hero__cta-secondary:hover {",
        "  background: rgba(255, 255, 255, 0.15);",
        "  border-color: #ffffff;",
        "  color: #ffffff;",
        "  transform: translateY(-2px);",
        "}",
        "",
        "/* Scroll indicator */",
        ".section-hero__scroll {",
        "  position: absolute;",
        "  bottom: var(--space-xl);",
        "  left: 50%;",
        "  transform: translateX(-50%);",
        "  z-index: 2;",
        "  display: flex;",
        "  flex-direction: column;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  color: rgba(255, 255, 255, 0.7);",
        "  font-size: var(--text-xs);",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.1em;",
        "  cursor: pointer;",
        "  animation: bounce 2s infinite;",
        "}",
        "",
        "@keyframes bounce {",
        "  0%, 100% { transform: translateX(-50%) translateY(0); }",
        "  50% { transform: translateX(-50%) translateY(6px); }",
        "}",
        "",
        "/* ═══════════════════════════════════════════",
        "   SECTIONS — common spacing fix",
        "   ═══════════════════════════════════════════ */",
        ".section-featured-products,",
        ".section-categories,",
        ".section-articles,",
        ".section-about,",
        ".section-contact {",
        "  padding: var(--space-3xl) 0;",
        "}",
        "",
        ".section-header {",
        "  text-align: center;",
        "  margin-bottom: var(--space-2xl);",
        "}",
        "",
        ".section-header h2 {",
        "  margin-bottom: var(--space-sm);",
        "}",
        "",
        ".section-header p {",
        "  color: var(--color-muted-foreground);",
        "  max-width: 600px;",
        "  margin: 0 auto;",
        "}",
        "",
        "/* Main content — no global padding-top; hero handles it internally */",
        "#main-content,",
        ".site-main {",
        "  padding-top: 0;",
        "}",
        "",
        "/* Non-hero top-level pages that DON'T have a hero need offset */",
        ".site-main .page-content,",
        ".site-main .entry-content,",
        "body:not(.home) .site-main {",
        "  padding-top: 5rem;",
        "}",
        "",
        "/* Front page — let sections breathe */",
        ".front-page {",
        "  padding-top: 0;",
        "}",
        "",
        "/* ═══════════════════════════════════════════",
        "   NAV — force remove bullet points",
        "   ═══════════════════════════════════════════ */",
        ".site-header__menu,",
        ".site-header__menu li,",
        ".site-header__menu ul,",
        "#primary-menu,",
        "#primary-menu li {",
        "  list-style: none !important;",
        "  list-style-type: none !important;",
        "  margin: 0;",
        "  padding: 0;",
        "}",
        "",
        "/* ═══════════════════════════════════════════",
        "   HEADER BRANDING — visible on white when scrolled",
        "   ═══════════════════════════════════════════ */",
        ".site-header.is-scrolled .site-header__brand-name,",
        ".site-header--scrolled .site-header__brand-name,",
        ".site-header.scrolled .site-header__brand-name {",
        "  color: var(--color-primary) !important;",
        "}",
        "",
        ".site-header.is-scrolled .site-header__tagline,",
        ".site-header--scrolled .site-header__tagline,",
        ".site-header.scrolled .site-header__tagline {",
        "  color: var(--color-muted-foreground) !important;",
        "}",
        "",
        "/* Before scroll: white text on gradient hero */",
        ".site-header:not(.is-scrolled):not(.site-header--scrolled):not(.scrolled) {",
        "  background: transparent;",
        "}",
        "",
        "/* ═══════════════════════════════════════════",
        "   FEATURED PRODUCTS SECTION",
        "   ═══════════════════════════════════════════ */",
        ".section-featured-products {",
        "  padding: var(--space-3xl) 0;",
        "  background: var(--color-background);",
        "}",
        "",
        ".section-featured-products__header {",
        "  text-align: center;",
        "  max-width: 700px;",
        "  margin: 0 auto var(--space-2xl) auto;",
        "}",
        "",
        ".section-featured-products__badge {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  background: rgba(14, 165, 233, 0.1);",
        "  color: var(--color-primary);",
        "  border: 1px solid rgba(14, 165, 233, 0.25);",
        "  border-radius: var(--radius-full);",
        "  padding: 0.35rem 1rem;",
        "  font-size: var(--text-sm);",
        "  font-weight: 700;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.06em;",
        "  margin-bottom: var(--space-md);",
        "}",
        "",
        ".section-featured-products__title {",
        "  font-size: var(--text-4xl);",
        "  font-weight: 900;",
        "  line-height: 1.15;",
        "  margin-bottom: var(--space-md);",
        "  color: var(--color-foreground);",
        "}",
        "",
        ".section-featured-products__subtitle {",
        "  font-size: var(--text-lg);",
        "  color: var(--color-muted-foreground);",
        "  line-height: 1.7;",
        "}",
        "",
        "/* 4-col desktop → 2-col tablet → 1-col mobile */",
        ".section-featured-products__grid {",
        "  display: grid;",
        "  grid-template-columns: 1fr;",
        "  gap: var(--space-lg);",
        "}",
        "",
        "@media (min-width: 640px) {",
        "  .section-featured-products__grid {",
        "    grid-template-columns: repeat(2, 1fr);",
        "  }",
        "}",
        "",
        "@media (min-width: 1024px) {",
        "  .section-featured-products__grid {",
        "    grid-template-columns: repeat(4, 1fr);",
        "  }",
        "}",
        "",
        "/* ── Product card ── */",
        ".product-card {",
        "  background: var(--color-card);",
        "  border: 1px solid var(--color-border);",
        "  border-radius: var(--radius-xl);",
        "  overflow: hidden;",
        "  display: flex;",
        "  flex-direction: column;",
        "  transition: all 0.3s ease;",
        "  box-shadow: var(--shadow-sm);",
        "}",
        "",
        ".product-card:hover {",
        "  box-shadow: var(--shadow-xl);",
        "  transform: translateY(-6px);",
        "  border-color: var(--color-primary);",
        "}",
        "",
        "/* Image wrapper (the template uses a <div> wrapping the <img>) */",
        ".product-card__image-wrapper {",
        "  position: relative;",
        "  overflow: hidden;",
        "  aspect-ratio: 4/3;",
        "  background: var(--color-muted);",
        "}",
        "",
        ".product-card__image-wrapper img,",
        ".product-card__image {",
        "  width: 100%;",
        "  height: 100%;",
        "  object-fit: cover;",
        "  transition: transform 0.4s ease;",
        "  display: block;",
        "}",
        "",
        ".product-card:hover .product-card__image-wrapper img,",
        ".product-card:hover .product-card__image {",
        "  transform: scale(1.07);",
        "}",
        "",
        "/* Badge on image */",
        ".product-card__badge {",
        "  position: absolute;",
        "  top: var(--space-sm);",
        "  left: var(--space-sm);",
        "  background: var(--color-primary);",
        "  color: #fff;",
        "  font-size: var(--text-xs);",
        "  font-weight: 700;",
        "  padding: 0.2rem 0.6rem;",
        "  border-radius: var(--radius-full);",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.05em;",
        "  z-index: 2;",
        "}",
        "",
        "/* Overlay shown on hover */",
        ".product-card__overlay {",
        "  position: absolute;",
        "  inset: 0;",
        "  background: rgba(14, 165, 233, 0.85);",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  opacity: 0;",
        "  transition: opacity 0.3s ease;",
        "  z-index: 3;",
        "}",
        "",
        ".product-card:hover .product-card__overlay {",
        "  opacity: 1;",
        "}",
        "",
        ".product-card__specs {",
        "  padding: var(--space-md);",
        "  color: #fff;",
        "  text-align: center;",
        "}",
        "",
        ".product-card__spec {",
        "  display: flex;",
        "  gap: var(--space-xs);",
        "  font-size: var(--text-sm);",
        "  justify-content: center;",
        "  margin-bottom: 0.4rem;",
        "}",
        "",
        ".product-card__spec-label {",
        "  opacity: 0.8;",
        "}",
        "",
        ".product-card__spec-value {",
        "  font-weight: 700;",
        "}",
        "",
        "/* Card body */",
        ".product-card__content {",
        "  padding: var(--space-md);",
        "  flex: 1;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: var(--space-sm);",
        "}",
        "",
        ".product-card__header {",
        "  display: flex;",
        "  justify-content: space-between;",
        "  align-items: flex-start;",
        "  gap: var(--space-sm);",
        "}",
        "",
        ".product-card__title {",
        "  font-size: var(--text-base);",
        "  font-weight: 700;",
        "  line-height: 1.35;",
        "  color: var(--color-card-foreground);",
        "  flex: 1;",
        "}",
        "",
        ".product-card__price {",
        "  display: flex;",
        "  flex-direction: column;",
        "  align-items: flex-end;",
        "  gap: 2px;",
        "  flex-shrink: 0;",
        "}",
        "",
        ".product-card__price-current {",
        "  font-size: var(--text-base);",
        "  font-weight: 800;",
        "  color: var(--color-primary);",
        "  white-space: nowrap;",
        "}",
        "",
        ".product-card__price-old {",
        "  font-size: var(--text-xs);",
        "  color: var(--color-muted-foreground);",
        "  text-decoration: line-through;",
        "}",
        "",
        ".product-card__description {",
        "  font-size: var(--text-sm);",
        "  color: var(--color-muted-foreground);",
        "  line-height: 1.6;",
        "  margin: 0;",
        "}",
        "",
        ".product-card__features {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 0.3rem;",
        "  flex: 1;",
        "}",
        "",
        ".product-card__feature {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: var(--space-xs);",
        "  font-size: var(--text-xs);",
        "  color: var(--color-foreground);",
        "}",
        "",
        ".product-card__feature-icon {",
        "  display: flex;",
        "  align-items: center;",
        "  color: var(--color-secondary);",
        "  flex-shrink: 0;",
        "}",
        "",
        ".product-card__actions {",
        "  display: flex;",
        "  gap: var(--space-sm);",
        "  padding-top: var(--space-sm);",
        "  border-top: 1px solid var(--color-border);",
        "  margin-top: auto;",
        "}",
        "",
        ".product-card__cta,",
        ".product-card__info {",
        "  flex: 1;",
        "  display: inline-flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  gap: 0.4rem;",
        "  padding: 0.55rem 0.75rem;",
        "  font-size: var(--text-xs);",
        "  font-weight: 700;",
        "  border-radius: var(--radius-md);",
        "  cursor: pointer;",
        "  transition: all 0.25s ease;",
        "  text-align: center;",
        "}",
        "",
        ".product-card__cta {",
        "  background: var(--color-primary);",
        "  color: #fff;",
        "  border: none;",
        "  text-decoration: none;",
        "}",
        "",
        ".product-card__cta:hover {",
        "  background: var(--color-electric-blue);",
        "  color: #fff;",
        "}",
        "",
        ".product-card__info {",
        "  background: transparent;",
        "  color: var(--color-primary);",
        "  border: 1.5px solid var(--color-primary);",
        "}",
        "",
        ".product-card__info:hover {",
        "  background: var(--color-primary);",
        "  color: #fff;",
        "}",
        "",
        "/* ═══════════════════════════════════════════",
        "   CATEGORIES SECTION",
        "   ═══════════════════════════════════════════ */",
        ".section-categories {",
        "  padding: var(--space-3xl) 0;",
        "  background: var(--color-muted);",
        "}",
        "",
        ".section-categories__header {",
        "  text-align: center;",
        "  max-width: 700px;",
        "  margin: 0 auto var(--space-2xl) auto;",
        "}",
        "",
        ".section-categories__badge {",
        "  display: inline-block;",
        "  background: rgba(14, 165, 233, 0.1);",
        "  color: var(--color-primary);",
        "  border: 1px solid rgba(14, 165, 233, 0.25);",
        "  border-radius: var(--radius-full);",
        "  padding: 0.35rem 1rem;",
        "  font-size: var(--text-xs);",
        "  font-weight: 700;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.1em;",
        "  margin-bottom: var(--space-md);",
        "}",
        "",
        ".section-categories__title {",
        "  font-size: var(--text-4xl);",
        "  font-weight: 900;",
        "  margin-bottom: var(--space-md);",
        "}",
        "",
        ".section-categories__description {",
        "  font-size: var(--text-lg);",
        "  color: var(--color-muted-foreground);",
        "  line-height: 1.7;",
        "}",
        "",
        "/* 3-col desktop → 2-col tablet → 1-col mobile */",
        ".section-categories__grid {",
        "  display: grid;",
        "  grid-template-columns: 1fr;",
        "  gap: var(--space-lg);",
        "}",
        "",
        "@media (min-width: 640px) {",
        "  .section-categories__grid {",
        "    grid-template-columns: repeat(2, 1fr);",
        "  }",
        "}",
        "",
        "@media (min-width: 1024px) {",
        "  .section-categories__grid {",
        "    grid-template-columns: repeat(3, 1fr);",
        "  }",
        "}",
        "",
        "/* ── Category card ── */",
        ".category-card {",
        "  background: var(--color-card);",
        "  border-radius: var(--radius-xl);",
        "  overflow: hidden;",
        "  box-shadow: var(--shadow-md);",
        "  display: flex;",
        "  flex-direction: column;",
        "  height: auto !important;            /* override old fixed height */",
        "  transition: all 0.3s ease;",
        "  cursor: pointer;",
        "}",
        "",
        ".category-card:hover {",
        "  transform: translateY(-6px) !important;",
        "  box-shadow: var(--shadow-xl) !important;",
        "}",
        "",
        "/* Image container div */",
        ".category-card__image {",
        "  position: relative;",
        "  height: 220px;",
        "  overflow: hidden;",
        "  flex-shrink: 0;",
        "  width: 100% !important;             /* override old img styles */",
        "  object-fit: unset !important;",
        "}",
        "",
        "/* Actual <img> inside the div */",
        ".category-card__img {",
        "  width: 100%;",
        "  height: 100%;",
        "  object-fit: cover;",
        "  display: block;",
        "  transition: transform 0.4s ease;",
        "}",
        "",
        ".category-card:hover .category-card__img {",
        "  transform: scale(1.08);",
        "}",
        "",
        "/* Overlay inside the image div */",
        ".category-card__overlay {",
        "  position: absolute;",
        "  inset: 0;",
        "  background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.3) 50%, transparent 100%);",
        "  display: flex;",
        "  align-items: flex-end;",
        "  z-index: 1;",
        "  transition: background 0.3s ease;",
        "}",
        "",
        ".category-card:hover .category-card__overlay {",
        "  background: linear-gradient(to top, rgba(14,165,233,0.9) 0%, rgba(14,165,233,0.5) 50%, transparent 100%);",
        "}",
        "",
        ".category-card__content {",
        "  padding: var(--space-md);",
        "  color: #fff;",
        "  width: 100%;",
        "}",
        "",
        ".category-card__title {",
        "  font-size: var(--text-xl);",
        "  font-weight: 800;",
        "  margin-bottom: 0.4rem;",
        "  text-shadow: 0 1px 4px rgba(0,0,0,0.3);",
        "  line-height: 1.3;",
        "}",
        "",
        ".category-card__description {",
        "  font-size: var(--text-sm);",
        "  opacity: 0.9;",
        "  line-height: 1.55;",
        "  margin-bottom: var(--space-sm);",
        "}",
        "",
        ".category-card__specs {",
        "  display: flex;",
        "  gap: var(--space-md);",
        "  flex-wrap: wrap;",
        "  margin-bottom: var(--space-sm);",
        "}",
        "",
        ".category-card__spec {",
        "  font-size: var(--text-xs);",
        "  opacity: 0.85;",
        "}",
        "",
        ".category-card__spec-label {",
        "  font-weight: 600;",
        "}",
        "",
        ".category-card__features {",
        "  display: flex;",
        "  flex-wrap: wrap;",
        "  gap: 0.3rem;",
        "  margin-bottom: var(--space-sm);",
        "}",
        "",
        ".category-card__feature {",
        "  background: rgba(255,255,255,0.2);",
        "  backdrop-filter: blur(4px);",
        "  border-radius: var(--radius-full);",
        "  padding: 0.2rem 0.6rem;",
        "  font-size: var(--text-xs);",
        "  font-weight: 600;",
        "}",
        "",
        ".category-card__actions {",
        "  margin-top: var(--space-sm);",
        "}",
        "",
        ".category-card__btn {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 0.4rem;",
        "  background: #fff;",
        "  color: var(--color-primary);",
        "  font-size: var(--text-xs);",
        "  font-weight: 700;",
        "  padding: 0.45rem 1rem;",
        "  border-radius: var(--radius-md);",
        "  transition: all 0.2s ease;",
        "  text-decoration: none;",
        "  border: none;",
        "}",
        "",
        ".category-card__btn:hover {",
        "  background: var(--color-primary);",
        "  color: #fff;",
        "}",
        "",
        ".category-card__btn-icon {",
        "  transition: transform 0.2s ease;",
        "}",
        "",
        ".category-card__btn:hover .category-card__btn-icon {",
        "  transform: translateX(3px);",
        "}",
        "",
        "/* Info bar below image */",
        ".category-card__info {",
        "  padding: var(--space-sm) var(--space-md);",
        "  background: var(--color-card);",
        "  border-top: 1px solid var(--color-border);",
        "}",
        "",
        ".category-card__stats {",
        "  display: flex;",
        "  gap: var(--space-lg);",
        "  justify-content: center;",
        "}",
        "",
        ".category-card__stat {",
        "  display: flex;",
        "  flex-direction: column;",
        "  align-items: center;",
        "  gap: 2px;",
        "}",
        "",
        ".category-card__stat-number {",
        "  font-size: var(--text-xl);",
        "  font-weight: 900;",
        "  color: var(--color-primary);",
        "  line-height: 1;",
        "}",
        "",
        ".category-card__stat-label {",
        "  font-size: var(--text-xs);",
        "  color: var(--color-muted-foreground);",
        "  text-align: center;",
        "}",
        "",
        "/* ============================================================",
        "   NAV HORIZONTAL — final fix (targets both real WP and router mock)",
        "   ============================================================ */",
        ".site-header__menu,",
        ".main-navigation ul {",
        "  display: flex !important;",
        "  flex-direction: row !important;",
        "  align-items: center !important;",
        "  gap: 0.25rem !important;",
        "  list-style: none !important;",
        "  list-style-type: none !important;",
        "  margin: 0 !important;",
        "  padding: 0 !important;",
        "}",
        ".site-header__menu li,",
        ".main-navigation ul li {",
        "  list-style: none !important;",
        "  list-style-type: none !important;",
        "  list-style-image: none !important;",
        "}",
        ".site-header__menu li::before,",
        ".site-header__menu li::marker,",
        ".main-navigation ul li::before,",
        ".main-navigation ul li::marker {",
        "  content: none !important;",
        "  display: none !important;",
        "}",
        ".main-navigation {",
        "  display: flex;",
        "  align-items: center;",
        "}",
        ".main-navigation ul li a,",
        ".site-header__menu li a {",
        "  display: block;",
        "  padding: 0.5rem 0.875rem;",
        "  color: rgba(255,255,255,0.9);",
        "  text-decoration: none;",
        "  font-size: 0.9rem;",
        "  font-weight: 500;",
        "  border-radius: 6px;",
        "  transition: background 0.2s, color 0.2s;",
        "  white-space: nowrap;",
        "}",
        ".main-navigation ul li a:hover,",
        ".site-header__menu li a:hover {",
        "  background: rgba(255,255,255,0.15);",
        "  color: #fff;",
        "}",
        ".site-header.is-scrolled .main-navigation ul li a,",
        ".site-header.is-scrolled .site-header__menu li a {",
        "  color: var(--color-foreground);",
        "}",
        ".site-header.is-scrolled .main-navigation ul li a:hover,",
        ".site-header.is-scrolled .site-header__menu li a:hover {",
        "  background: var(--color-muted);",
        "  color: var(--color-primary);",
        "}",
        "",
        "/* ============================================================",
        "   HERO VISUAL SECTION",
        "   ============================================================ */",
        ".section-hero__visual {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "}",
        ".section-hero__image-wrapper {",
        "  position: relative;",
        "  display: flex;",
        "  flex-direction: column;",
        "  align-items: center;",
        "  gap: 1.5rem;",
        "}",
        "",
        "  50%       { opacity: 1;   transform: scale(1.15); }",
        "}",
        ".section-hero__stats {",
        "  display: flex;",
        "  gap: 1.5rem;",
        "  background: rgba(255,255,255,0.12);",
        "  backdrop-filter: blur(12px);",
        "  -webkit-backdrop-filter: blur(12px);",
        "  border: 1px solid rgba(255,255,255,0.2);",
        "  border-radius: 16px;",
        "  padding: 1rem 1.5rem;",
        "}",
        ".section-hero__stat {",
        "  text-align: center;",
        "}",
        ".section-hero__stat-number {",
        "  font-size: 1.25rem;",
        "  font-weight: 700;",
        "  color: #fff;",
        "  line-height: 1;",
        "}",
        ".section-hero__stat-label {",
        "  font-size: 0.7rem;",
        "  color: rgba(255,255,255,0.8);",
        "  margin-top: 0.25rem;",
        "  white-space: nowrap;",
        "}",
        "",
        "/* Responsive hero 2-col → 1-col */",
        "@media (max-width: 768px) {",
        "  .section-hero__stats {",
        "    gap: 1rem;",
        "    padding: 0.75rem 1rem;",
        "  }",
        "}",
        "}",
        "",
        "/* ============================================================",
        "   ABOUT SECTION — full styles",
        "   ============================================================ */",
        ".section-about {",
        "  padding: 5rem 0;",
        "  background: var(--color-background, #fff);",
        "}",
        ".section-about__header {",
        "  text-align: center;",
        "  margin-bottom: 3.5rem;",
        "}",
        ".section-about__badge {",
        "  display: inline-block;",
        "  padding: 0.35rem 1rem;",
        "  background: rgba(37,99,235,0.1);",
        "  color: #2563eb;",
        "  border-radius: 999px;",
        "  font-size: 0.8rem;",
        "  font-weight: 600;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.06em;",
        "  margin-bottom: 0.75rem;",
        "}",
        ".section-about__title {",
        "  font-size: clamp(1.6rem, 3vw, 2.25rem);",
        "  font-weight: 800;",
        "  color: var(--color-foreground, #0f172a);",
        "  line-height: 1.2;",
        "}",
        "",
        "/* 2-column main layout */",
        ".section-about__main {",
        "  display: grid;",
        "  grid-template-columns: 1fr 1fr;",
        "  gap: 4rem;",
        "  align-items: start;",
        "  margin-bottom: 4rem;",
        "}",
        "@media (max-width: 900px) {",
        "  .section-about__main { grid-template-columns: 1fr; gap: 2.5rem; }",
        "}",
        "",
        "/* Story (left column) */",
        ".about-story__title {",
        "  font-size: 1.4rem;",
        "  font-weight: 700;",
        "  color: #0f172a;",
        "  margin-bottom: 1rem;",
        "}",
        ".about-story__description {",
        "  color: #475569;",
        "  line-height: 1.75;",
        "  margin-bottom: 1.5rem;",
        "}",
        ".about-story__description p { margin-bottom: 0.75rem; }",
        ".about-story__highlights {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 1.25rem;",
        "  margin-bottom: 2rem;",
        "}",
        ".about-highlight {",
        "  display: flex;",
        "  gap: 1rem;",
        "  align-items: flex-start;",
        "}",
        ".about-highlight__icon {",
        "  flex-shrink: 0;",
        "  width: 2rem;",
        "  height: 2rem;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  background: rgba(37,99,235,0.1);",
        "  border-radius: 50%;",
        "  color: #2563eb;",
        "}",
        ".about-highlight__title {",
        "  font-size: 0.95rem;",
        "  font-weight: 600;",
        "  color: #0f172a;",
        "  margin-bottom: 0.2rem;",
        "}",
        ".about-highlight__description {",
        "  font-size: 0.875rem;",
        "  color: #64748b;",
        "  line-height: 1.5;",
        "}",
        ".about-story__cta {",
        "  display: flex;",
        "  gap: 1rem;",
        "  flex-wrap: wrap;",
        "}",
        "",
        "/* Visual (right column) */",
        ".about-visual { position: relative; }",
        ".about-visual__main-image {",
        "  position: relative;",
        "  border-radius: 16px;",
        "  overflow: hidden;",
        "  box-shadow: 0 20px 60px rgba(0,0,0,0.12);",
        "}",
        ".about-visual__img {",
        "  width: 100%;",
        "  height: 380px;",
        "  object-fit: cover;",
        "  display: block;",
        "}",
        ".about-visual__badge {",
        "  position: absolute;",
        "  bottom: 1.5rem;",
        "  right: 1.5rem;",
        "  background: #fff;",
        "  border-radius: 12px;",
        "  padding: 0.75rem 1.25rem;",
        "  box-shadow: 0 8px 24px rgba(0,0,0,0.15);",
        "  text-align: center;",
        "}",
        ".about-visual__badge-number {",
        "  font-size: 1.75rem;",
        "  font-weight: 800;",
        "  color: #2563eb;",
        "  line-height: 1;",
        "}",
        ".about-visual__badge-text {",
        "  font-size: 0.75rem;",
        "  color: #64748b;",
        "  font-weight: 500;",
        "}",
        ".about-visual__secondary-images {",
        "  display: grid;",
        "  grid-template-columns: 1fr 1fr;",
        "  gap: 0.75rem;",
        "  margin-top: 0.75rem;",
        "}",
        ".about-visual__secondary-image { border-radius: 10px; overflow: hidden; }",
        ".about-visual__secondary-img {",
        "  width: 100%;",
        "  height: 130px;",
        "  object-fit: cover;",
        "  display: block;",
        "}",
        "",
        "/* Stats row */",
        ".section-about__stats { margin-bottom: 4rem; }",
        ".company-stats {",
        "  display: grid;",
        "  grid-template-columns: repeat(4, 1fr);",
        "  gap: 1.5rem;",
        "}",
        "@media (max-width: 768px) {",
        "  .company-stats { grid-template-columns: repeat(2, 1fr); }",
        "}",
        ".company-stat {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 1rem;",
        "  padding: 1.5rem;",
        "  background: #f8fafc;",
        "  border: 1px solid #e2e8f0;",
        "  border-radius: 14px;",
        "}",
        ".company-stat__icon {",
        "  flex-shrink: 0;",
        "  width: 3rem;",
        "  height: 3rem;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  background: rgba(37,99,235,0.1);",
        "  border-radius: 10px;",
        "  color: #2563eb;",
        "}",
        ".company-stat__number {",
        "  font-size: 1.6rem;",
        "  font-weight: 800;",
        "  color: #0f172a;",
        "  line-height: 1;",
        "}",
        ".company-stat__label {",
        "  font-size: 0.8rem;",
        "  color: #64748b;",
        "  margin-top: 0.2rem;",
        "}",
        "",
        "/* Certifications */",
        ".section-about__certifications { margin-bottom: 4rem; }",
        ".certifications__header { text-align: center; margin-bottom: 2rem; }",
        ".certifications__title {",
        "  font-size: 1.5rem;",
        "  font-weight: 700;",
        "  color: #0f172a;",
        "  margin-bottom: 0.5rem;",
        "}",
        ".certifications__description {",
        "  color: #64748b;",
        "  max-width: 520px;",
        "  margin: 0 auto;",
        "}",
        ".certifications__grid {",
        "  display: grid;",
        "  grid-template-columns: repeat(4, 1fr);",
        "  gap: 1.5rem;",
        "}",
        "@media (max-width: 900px) {",
        "  .certifications__grid { grid-template-columns: repeat(2, 1fr); }",
        "}",
        ".certification-card {",
        "  display: flex;",
        "  flex-direction: column;",
        "  align-items: center;",
        "  text-align: center;",
        "  padding: 2rem 1.5rem;",
        "  background: #fff;",
        "  border: 1px solid #e2e8f0;",
        "  border-radius: 16px;",
        "  box-shadow: 0 2px 12px rgba(0,0,0,0.05);",
        "  transition: transform 0.2s, box-shadow 0.2s;",
        "}",
        ".certification-card:hover {",
        "  transform: translateY(-4px);",
        "  box-shadow: 0 12px 32px rgba(0,0,0,0.1);",
        "}",
        ".certification-card__badge {",
        "  width: 4rem;",
        "  height: 4rem;",
        "  border-radius: 50%;",
        "  background: rgba(37,99,235,0.1);",
        "  border: 2px solid var(--cert-color, #2563eb);",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  margin-bottom: 1rem;",
        "}",
        ".certification-card__abbr {",
        "  font-size: 1rem;",
        "  font-weight: 800;",
        "  color: var(--cert-color, #2563eb);",
        "  letter-spacing: -0.02em;",
        "}",
        ".certification-card__name {",
        "  font-size: 1rem;",
        "  font-weight: 700;",
        "  color: #0f172a;",
        "  margin-bottom: 0.4rem;",
        "}",
        ".certification-card__description {",
        "  font-size: 0.8rem;",
        "  color: #64748b;",
        "  line-height: 1.5;",
        "  margin-bottom: 0.75rem;",
        "}",
        ".certification-card__meta {",
        "  display: flex;",
        "  gap: 0.5rem;",
        "  flex-wrap: wrap;",
        "  justify-content: center;",
        "}",
        ".certification-card__year {",
        "  padding: 0.2rem 0.6rem;",
        "  background: #f1f5f9;",
        "  border-radius: 999px;",
        "  font-size: 0.72rem;",
        "  color: #475569;",
        "  font-weight: 500;",
        "}",
        ".certification-card__status {",
        "  padding: 0.2rem 0.6rem;",
        "  background: rgba(5,150,105,0.1);",
        "  border-radius: 999px;",
        "  font-size: 0.72rem;",
        "  color: #059669;",
        "  font-weight: 500;",
        "}",
        "",
        "/* Capabilities */",
        ".capabilities__header { text-align: center; margin-bottom: 2rem; }",
        ".capabilities__title {",
        "  font-size: 1.5rem;",
        "  font-weight: 700;",
        "  color: #0f172a;",
        "  margin-bottom: 0.5rem;",
        "}",
        ".capabilities__description { color: #64748b; }",
        ".capabilities__grid {",
        "  display: grid;",
        "  grid-template-columns: repeat(4, 1fr);",
        "  gap: 1.5rem;",
        "}",
        "@media (max-width: 900px) {",
        "  .capabilities__grid { grid-template-columns: repeat(2, 1fr); }",
        "}",
        ".capability-card {",
        "  padding: 1.75rem;",
        "  background: #f8fafc;",
        "  border: 1px solid #e2e8f0;",
        "  border-radius: 14px;",
        "  transition: box-shadow 0.2s;",
        "}",
        ".capability-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.08); }",
        ".capability-card__icon {",
        "  width: 3.5rem;",
        "  height: 3.5rem;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  background: rgba(37,99,235,0.1);",
        "  border-radius: 12px;",
        "  color: #2563eb;",
        "  margin-bottom: 1rem;",
        "}",
        ".capability-card__title {",
        "  font-size: 1rem;",
        "  font-weight: 700;",
        "  color: #0f172a;",
        "  margin-bottom: 0.5rem;",
        "}",
        ".capability-card__description {",
        "  font-size: 0.85rem;",
        "  color: #64748b;",
        "  line-height: 1.6;",
        "  margin-bottom: 0.75rem;",
        "}",
        ".capability-card__stats { display: flex; flex-direction: column; gap: 0.3rem; }",
        ".capability-card__stat {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 0.4rem;",
        "  font-size: 0.8rem;",
        "  color: #475569;",
        "}",
        ".capability-card__stat-icon { color: #059669; flex-shrink: 0; }",
        "",
        "/* ============================================================",
        "   FOOTER — full BEM styles (site-footer__*)",
        "   ============================================================ */",
        ".site-footer {",
        "  background: #0f172a;",
        "  color: #94a3b8;",
        "}",
        ".site-footer__main { padding: 4rem 0 2.5rem; }",
        ".site-footer__grid {",
        "  display: grid;",
        "  grid-template-columns: 2fr 1fr 1fr 1.5fr;",
        "  gap: 3rem;",
        "}",
        "@media (max-width: 900px) {",
        "  .site-footer__grid { grid-template-columns: 1fr 1fr; gap: 2rem; }",
        "  .site-footer__column--brand { grid-column: 1 / -1; }",
        "}",
        "@media (max-width: 480px) {",
        "  .site-footer__grid { grid-template-columns: 1fr; }",
        "}",
        ".site-footer__brand-name {",
        "  font-size: 1.25rem;",
        "  font-weight: 800;",
        "  color: #fff;",
        "  display: block;",
        "  margin-bottom: 0.2rem;",
        "}",
        ".site-footer__tagline {",
        "  font-size: 0.8rem;",
        "  color: #64748b;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.08em;",
        "  display: block;",
        "  margin-bottom: 1rem;",
        "}",
        ".site-footer__description {",
        "  font-size: 0.875rem;",
        "  color: #94a3b8;",
        "  line-height: 1.7;",
        "  margin-bottom: 1.5rem;",
        "}",
        ".site-footer__social { display: flex; gap: 0.75rem; }",
        ".site-footer__social-link {",
        "  width: 2.25rem;",
        "  height: 2.25rem;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  background: rgba(255,255,255,0.08);",
        "  border-radius: 8px;",
        "  color: #94a3b8;",
        "  text-decoration: none;",
        "  transition: background 0.2s, color 0.2s;",
        "}",
        ".site-footer__social-link:hover { background: #2563eb; color: #fff; }",
        ".site-footer__heading {",
        "  font-size: 0.875rem;",
        "  font-weight: 700;",
        "  color: #fff;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.08em;",
        "  margin-bottom: 1.25rem;",
        "}",
        ".site-footer__nav-list {",
        "  list-style: none !important;",
        "  list-style-type: none !important;",
        "  padding: 0;",
        "  margin: 0;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 0.6rem;",
        "}",
        ".site-footer__nav-list li { list-style: none !important; }",
        ".site-footer__nav-link {",
        "  font-size: 0.875rem;",
        "  color: #94a3b8;",
        "  text-decoration: none;",
        "  transition: color 0.2s;",
        "  display: inline-block;",
        "}",
        ".site-footer__nav-link:hover { color: #fff; }",
        ".site-footer__contact { display: flex; flex-direction: column; gap: 1rem; }",
        ".site-footer__contact-item {",
        "  display: flex;",
        "  align-items: flex-start;",
        "  gap: 0.75rem;",
        "  font-size: 0.875rem;",
        "  color: #94a3b8;",
        "}",
        ".site-footer__contact-item svg { flex-shrink: 0; margin-top: 0.2rem; color: #2563eb; }",
        ".site-footer__contact-item strong { color: #cbd5e1; }",
        ".site-footer__contact-item a { color: #94a3b8; text-decoration: none; }",
        ".site-footer__contact-item a:hover { color: #fff; }",
        ".site-footer__bottom {",
        "  border-top: 1px solid rgba(255,255,255,0.08);",
        "  padding: 1.25rem 0;",
        "}",
        ".site-footer__bottom-content {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  gap: 1rem;",
        "  flex-wrap: wrap;",
        "}",
        ".site-footer__copyright p { font-size: 0.8rem; color: #64748b; margin: 0; }",
        ".site-footer__legal-list {",
        "  list-style: none !important;",
        "  list-style-type: none !important;",
        "  padding: 0;",
        "  margin: 0;",
        "  display: flex;",
        "  gap: 1.5rem;",
        "}",
        ".site-footer__legal-list li { list-style: none !important; }",
        ".site-footer__legal-link {",
        "  font-size: 0.8rem;",
        "  color: #64748b;",
        "  text-decoration: none;",
        "  transition: color 0.2s;",
        "}",
        ".site-footer__legal-link:hover { color: #94a3b8; }",
        "",
        "/* =============================================================================",
        "   ABOUT CTA",
        "   ============================================================================= */",
        ".section-about__cta { margin-top: 4rem; }",
        ".about-cta {",
        "  background: linear-gradient(135deg, #1e40af 0%, #0891b2 100%);",
        "  border-radius: 1.5rem;",
        "  padding: 3rem 3.5rem;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  gap: 2rem;",
        "  box-shadow: 0 20px 60px rgba(30, 64, 175, 0.35);",
        "}",
        ".about-cta__content { flex: 1; }",
        ".about-cta__title {",
        "  font-size: 1.75rem;",
        "  font-weight: 700;",
        "  color: #fff;",
        "  margin: 0 0 0.75rem;",
        "  line-height: 1.3;",
        "}",
        ".about-cta__description {",
        "  font-size: 1rem;",
        "  color: rgba(255,255,255,0.85);",
        "  margin: 0;",
        "  line-height: 1.6;",
        "}",
        ".about-cta__actions {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 1.25rem;",
        "  flex-shrink: 0;",
        "}",
        ".about-cta__actions .btn-primary {",
        "  background: #fff;",
        "  color: #1e40af;",
        "  border: none;",
        "  padding: 0.85rem 2rem;",
        "  border-radius: 0.5rem;",
        "  font-weight: 700;",
        "  font-size: 0.9375rem;",
        "  text-decoration: none;",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 0.5rem;",
        "  transition: box-shadow 0.2s, transform 0.2s;",
        "}",
        ".about-cta__actions .btn-primary:hover {",
        "  box-shadow: 0 8px 24px rgba(0,0,0,0.2);",
        "  transform: translateY(-2px);",
        "}",
        ".about-cta__phone {",
        "  color: rgba(255,255,255,0.9);",
        "  font-weight: 600;",
        "  font-size: 0.9375rem;",
        "  text-decoration: none;",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 0.5rem;",
        "  transition: color 0.2s;",
        "}",
        ".about-cta__phone:hover { color: #fff; }",
        "@media (max-width: 768px) {",
        "  .about-cta { flex-direction: column; text-align: center; padding: 2rem 1.5rem; }",
        "  .about-cta__actions { flex-direction: column; width: 100%; }",
        "  .about-cta__actions .btn-primary { justify-content: center; }",
        "}",
        "",
        "/* =============================================================================",
        "   EDITORIAL SECTION",
        "   ============================================================================= */",
        ".section-editorial {",
        "  padding: 5rem 0;",
        "  background: #f8fafc;",
        "}",
        ".section-editorial__header {",
        "  text-align: center;",
        "  margin-bottom: 3.5rem;",
        "}",
        ".section-editorial__badge {",
        "  display: inline-block;",
        "  background: linear-gradient(135deg, #eff6ff, #e0f2fe);",
        "  color: #1e40af;",
        "  font-size: 0.8125rem;",
        "  font-weight: 700;",
        "  letter-spacing: 0.06em;",
        "  text-transform: uppercase;",
        "  padding: 0.375rem 1rem;",
        "  border-radius: 2rem;",
        "  border: 1px solid #bfdbfe;",
        "  margin-bottom: 1rem;",
        "}",
        ".section-editorial__title {",
        "  font-size: clamp(1.75rem, 3vw, 2.5rem);",
        "  font-weight: 800;",
        "  color: #0f172a;",
        "  margin: 0 0 1rem;",
        "  line-height: 1.2;",
        "}",
        ".section-editorial__description {",
        "  font-size: 1.0625rem;",
        "  color: #475569;",
        "  max-width: 640px;",
        "  margin: 0 auto;",
        "  line-height: 1.7;",
        "}",
        "",
        "/* Featured article – 2-column card */",
        ".section-editorial__featured { margin-bottom: 3rem; }",
        ".featured-article {",
        "  display: grid;",
        "  grid-template-columns: 1fr 1fr;",
        "  background: #fff;",
        "  border-radius: 1.25rem;",
        "  overflow: hidden;",
        "  box-shadow: 0 4px 24px rgba(15,23,42,0.08);",
        "  transition: box-shadow 0.3s, transform 0.3s;",
        "}",
        ".featured-article:hover {",
        "  box-shadow: 0 12px 40px rgba(15,23,42,0.14);",
        "  transform: translateY(-3px);",
        "}",
        ".featured-article__image {",
        "  position: relative;",
        "  overflow: hidden;",
        "  min-height: 380px;",
        "}",
        ".featured-article__img {",
        "  width: 100%;",
        "  height: 100%;",
        "  object-fit: cover;",
        "  display: block;",
        "  transition: transform 0.5s ease;",
        "}",
        ".featured-article:hover .featured-article__img { transform: scale(1.04); }",
        ".featured-article__overlay {",
        "  position: absolute;",
        "  bottom: 0;",
        "  left: 0;",
        "  right: 0;",
        "  background: linear-gradient(to top, rgba(15,23,42,0.8) 0%, transparent 100%);",
        "  padding: 1.5rem;",
        "}",
        ".featured-article__meta {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 0.75rem;",
        "}",
        ".featured-article__category {",
        "  background: #2563eb;",
        "  color: #fff;",
        "  font-size: 0.75rem;",
        "  font-weight: 700;",
        "  padding: 0.25rem 0.75rem;",
        "  border-radius: 1rem;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.04em;",
        "}",
        ".featured-article__date {",
        "  color: rgba(255,255,255,0.8);",
        "  font-size: 0.8125rem;",
        "}",
        ".featured-article__content {",
        "  padding: 2.5rem 2rem;",
        "  display: flex;",
        "  flex-direction: column;",
        "  justify-content: center;",
        "  gap: 1rem;",
        "}",
        ".featured-article__tags {",
        "  display: flex;",
        "  flex-wrap: wrap;",
        "  gap: 0.5rem;",
        "}",
        ".featured-article__tag {",
        "  background: #eff6ff;",
        "  color: #2563eb;",
        "  font-size: 0.75rem;",
        "  font-weight: 600;",
        "  padding: 0.2rem 0.65rem;",
        "  border-radius: 1rem;",
        "  border: 1px solid #bfdbfe;",
        "}",
        ".featured-article__title {",
        "  font-size: 1.4375rem;",
        "  font-weight: 800;",
        "  color: #0f172a;",
        "  line-height: 1.35;",
        "  margin: 0;",
        "}",
        ".featured-article__excerpt {",
        "  font-size: 0.9375rem;",
        "  color: #475569;",
        "  line-height: 1.7;",
        "  margin: 0;",
        "}",
        ".featured-article__stats {",
        "  display: flex;",
        "  gap: 1.25rem;",
        "}",
        ".featured-article__stat {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 0.375rem;",
        "  color: #64748b;",
        "  font-size: 0.875rem;",
        "}",
        ".featured-article__stat-icon {",
        "  flex-shrink: 0;",
        "  opacity: 0.7;",
        "}",
        ".featured-article__actions {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 1rem;",
        "  margin-top: 0.5rem;",
        "}",
        ".featured-article__actions .btn-primary {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 0.5rem;",
        "  padding: 0.75rem 1.5rem;",
        "  font-size: 0.875rem;",
        "  font-weight: 700;",
        "  border-radius: 0.5rem;",
        "  text-decoration: none;",
        "  background: linear-gradient(135deg, #2563eb, #0891b2);",
        "  color: #fff;",
        "  border: none;",
        "  transition: box-shadow 0.2s, transform 0.2s;",
        "}",
        ".featured-article__actions .btn-primary:hover {",
        "  box-shadow: 0 6px 20px rgba(37,99,235,0.35);",
        "  transform: translateY(-1px);",
        "}",
        ".featured-article__bookmark {",
        "  background: #f1f5f9;",
        "  border: 1px solid #e2e8f0;",
        "  border-radius: 0.5rem;",
        "  padding: 0.625rem;",
        "  cursor: pointer;",
        "  color: #64748b;",
        "  display: flex;",
        "  align-items: center;",
        "  transition: background 0.2s, color 0.2s;",
        "}",
        ".featured-article__bookmark:hover { background: #eff6ff; color: #2563eb; }",
        "",
        "/* Article cards grid */",
        ".section-editorial__grid {",
        "  display: grid;",
        "  grid-template-columns: repeat(3, 1fr);",
        "  gap: 1.5rem;",
        "  margin-bottom: 3rem;",
        "}",
        ".article-card {",
        "  background: #fff;",
        "  border-radius: 1rem;",
        "  overflow: hidden;",
        "  box-shadow: 0 2px 12px rgba(15,23,42,0.06);",
        "  display: flex;",
        "  flex-direction: column;",
        "  transition: box-shadow 0.3s, transform 0.3s;",
        "}",
        ".article-card:hover {",
        "  box-shadow: 0 8px 32px rgba(15,23,42,0.12);",
        "  transform: translateY(-3px);",
        "}",
        ".article-card__image {",
        "  position: relative;",
        "  height: 200px;",
        "  overflow: hidden;",
        "}",
        ".article-card__img {",
        "  width: 100%;",
        "  height: 100%;",
        "  object-fit: cover;",
        "  display: block;",
        "  transition: transform 0.4s ease;",
        "}",
        ".article-card:hover .article-card__img { transform: scale(1.05); }",
        ".article-card__overlay {",
        "  position: absolute;",
        "  top: 0.75rem;",
        "  left: 0.75rem;",
        "}",
        ".article-card__category {",
        "  background: rgba(37,99,235,0.9);",
        "  color: #fff;",
        "  font-size: 0.6875rem;",
        "  font-weight: 700;",
        "  padding: 0.2rem 0.6rem;",
        "  border-radius: 1rem;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.04em;",
        "  backdrop-filter: blur(4px);",
        "}",
        ".article-card__content {",
        "  padding: 1.25rem;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 0.625rem;",
        "  flex: 1;",
        "}",
        ".article-card__meta {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 0.4rem;",
        "  color: #94a3b8;",
        "  font-size: 0.75rem;",
        "}",
        ".article-card__separator { color: #cbd5e1; }",
        ".article-card__title {",
        "  font-size: 1rem;",
        "  font-weight: 700;",
        "  color: #0f172a;",
        "  line-height: 1.4;",
        "  margin: 0;",
        "}",
        ".article-card__excerpt {",
        "  font-size: 0.875rem;",
        "  color: #64748b;",
        "  line-height: 1.6;",
        "  margin: 0;",
        "  display: -webkit-box;",
        "  -webkit-line-clamp: 3;",
        "  -webkit-box-orient: vertical;",
        "  overflow: hidden;",
        "}",
        ".article-card__tags {",
        "  display: flex;",
        "  flex-wrap: wrap;",
        "  gap: 0.375rem;",
        "}",
        ".article-card__tag {",
        "  background: #f1f5f9;",
        "  color: #475569;",
        "  font-size: 0.6875rem;",
        "  font-weight: 600;",
        "  padding: 0.15rem 0.5rem;",
        "  border-radius: 1rem;",
        "  border: 1px solid #e2e8f0;",
        "}",
        ".article-card__footer {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  padding-top: 0.75rem;",
        "  border-top: 1px solid #f1f5f9;",
        "  margin-top: auto;",
        "}",
        ".article-card__link {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 0.375rem;",
        "  color: #2563eb;",
        "  font-size: 0.8125rem;",
        "  font-weight: 600;",
        "  text-decoration: none;",
        "  transition: gap 0.2s;",
        "}",
        ".article-card__link:hover { gap: 0.625rem; }",
        ".article-card__stats { display: flex; align-items: center; gap: 0.25rem; }",
        ".article-card__views { font-size: 0.75rem; color: #94a3b8; }",
        ".article-card__views-icon { color: #cbd5e1; }",
        "",
        "/* Newsletter signup */",
        ".section-editorial__newsletter { margin-top: 1rem; }",
        ".newsletter-signup {",
        "  background: linear-gradient(135deg, #1e3a8a 0%, #0e7490 100%);",
        "  border-radius: 1.25rem;",
        "  padding: 3rem 3.5rem;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  gap: 3rem;",
        "  box-shadow: 0 16px 48px rgba(30, 58, 138, 0.3);",
        "}",
        ".newsletter-signup__content { flex: 1; }",
        ".newsletter-signup__icon {",
        "  width: 3rem;",
        "  height: 3rem;",
        "  background: rgba(255,255,255,0.15);",
        "  border-radius: 0.75rem;",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  margin-bottom: 1rem;",
        "  color: #fff;",
        "}",
        ".newsletter-signup__title {",
        "  font-size: 1.5rem;",
        "  font-weight: 800;",
        "  color: #fff;",
        "  margin: 0 0 0.5rem;",
        "}",
        ".newsletter-signup__description {",
        "  font-size: 0.9375rem;",
        "  color: rgba(255,255,255,0.8);",
        "  margin: 0;",
        "  line-height: 1.6;",
        "}",
        ".newsletter-signup__form { flex: 1; max-width: 460px; }",
        ".newsletter-signup__input-group {",
        "  display: flex;",
        "  gap: 0.75rem;",
        "  margin-bottom: 0.75rem;",
        "}",
        ".newsletter-signup__input {",
        "  flex: 1;",
        "  padding: 0.875rem 1rem;",
        "  border-radius: 0.5rem;",
        "  border: 2px solid rgba(255,255,255,0.2);",
        "  background: rgba(255,255,255,0.12);",
        "  color: #fff;",
        "  font-size: 0.9375rem;",
        "  outline: none;",
        "  transition: border-color 0.2s, background 0.2s;",
        "}",
        ".newsletter-signup__input::placeholder { color: rgba(255,255,255,0.5); }",
        ".newsletter-signup__input:focus {",
        "  border-color: rgba(255,255,255,0.5);",
        "  background: rgba(255,255,255,0.18);",
        "}",
        ".newsletter-signup__btn {",
        "  padding: 0.875rem 1.5rem;",
        "  background: #fff;",
        "  color: #1e40af;",
        "  border: none;",
        "  border-radius: 0.5rem;",
        "  font-weight: 700;",
        "  font-size: 0.875rem;",
        "  cursor: pointer;",
        "  white-space: nowrap;",
        "  transition: box-shadow 0.2s, transform 0.2s;",
        "}",
        ".newsletter-signup__btn:hover {",
        "  box-shadow: 0 6px 20px rgba(0,0,0,0.2);",
        "  transform: translateY(-1px);",
        "}",
        ".newsletter-signup__privacy {",
        "  font-size: 0.75rem;",
        "  color: rgba(255,255,255,0.6);",
        "  margin: 0;",
        "}",
        ".newsletter-signup__privacy-link {",
        "  color: rgba(255,255,255,0.8);",
        "  text-decoration: underline;",
        "}",
        "@media (max-width: 900px) {",
        "  .featured-article { grid-template-columns: 1fr; }",
        "  .featured-article__image { min-height: 260px; }",
        "  .section-editorial__grid { grid-template-columns: repeat(2, 1fr); }",
        "  .newsletter-signup { flex-direction: column; gap: 2rem; padding: 2rem 1.5rem; }",
        "  .newsletter-signup__form { max-width: 100%; width: 100%; }",
        "}",
        "@media (max-width: 600px) {",
        "  .section-editorial__grid { grid-template-columns: 1fr; }",
        "  .newsletter-signup__input-group { flex-direction: column; }",
        "  .newsletter-signup__btn { width: 100%; }",
        "}",
        "",
        "/* =============================================================================",
        "   ARCHIVES GALLERY SECTION",
        "   ============================================================================= */",
        ".section-archives-gallery {",
        "  padding: 5rem 0;",
        "  background: #fff;",
        "}",
        ".section-archives-gallery__header {",
        "  text-align: center;",
        "  margin-bottom: 2.5rem;",
        "}",
        ".section-archives-gallery__badge {",
        "  display: inline-block;",
        "  background: linear-gradient(135deg, #f0fdf4, #dcfce7);",
        "  color: #15803d;",
        "  font-size: 0.8125rem;",
        "  font-weight: 700;",
        "  letter-spacing: 0.06em;",
        "  text-transform: uppercase;",
        "  padding: 0.375rem 1rem;",
        "  border-radius: 2rem;",
        "  border: 1px solid #bbf7d0;",
        "  margin-bottom: 1rem;",
        "}",
        ".section-archives-gallery__title {",
        "  font-size: clamp(1.75rem, 3vw, 2.5rem);",
        "  font-weight: 800;",
        "  color: #0f172a;",
        "  margin: 0 0 1rem;",
        "}",
        ".section-archives-gallery__description {",
        "  font-size: 1.0625rem;",
        "  color: #475569;",
        "  max-width: 600px;",
        "  margin: 0 auto;",
        "  line-height: 1.7;",
        "}",
        "",
        "/* Filter buttons */",
        ".section-archives-gallery__filters {",
        "  display: flex;",
        "  flex-wrap: wrap;",
        "  justify-content: center;",
        "  gap: 0.625rem;",
        "  margin-bottom: 2.5rem;",
        "}",
        ".gallery-filter {",
        "  padding: 0.5rem 1.25rem;",
        "  border-radius: 2rem;",
        "  border: 1.5px solid #e2e8f0;",
        "  background: #fff;",
        "  color: #475569;",
        "  font-size: 0.875rem;",
        "  font-weight: 600;",
        "  cursor: pointer;",
        "  transition: background 0.2s, color 0.2s, border-color 0.2s;",
        "}",
        ".gallery-filter:hover {",
        "  background: #eff6ff;",
        "  color: #2563eb;",
        "  border-color: #93c5fd;",
        "}",
        ".gallery-filter--active {",
        "  background: #2563eb;",
        "  color: #fff;",
        "  border-color: #2563eb;",
        "}",
        "",
        "/* Gallery grid */",
        ".section-archives-gallery__grid {",
        "  display: grid;",
        "  grid-template-columns: repeat(3, 1fr);",
        "  gap: 1.5rem;",
        "  margin-bottom: 2.5rem;",
        "}",
        ".gallery-item {",
        "  border-radius: 1rem;",
        "  overflow: hidden;",
        "  background: #f8fafc;",
        "  box-shadow: 0 2px 12px rgba(15,23,42,0.06);",
        "  transition: box-shadow 0.3s, transform 0.3s;",
        "}",
        ".gallery-item:hover {",
        "  box-shadow: 0 10px 36px rgba(15,23,42,0.14);",
        "  transform: translateY(-4px);",
        "}",
        ".gallery-item__image-wrapper {",
        "  position: relative;",
        "  height: 240px;",
        "  overflow: hidden;",
        "}",
        ".gallery-item__image {",
        "  width: 100%;",
        "  height: 100%;",
        "  object-fit: cover;",
        "  display: block;",
        "  transition: transform 0.5s ease;",
        "}",
        ".gallery-item:hover .gallery-item__image { transform: scale(1.06); }",
        ".gallery-item__overlay {",
        "  position: absolute;",
        "  inset: 0;",
        "  background: linear-gradient(to top, rgba(15,23,42,0.88) 0%, rgba(15,23,42,0.2) 60%, transparent 100%);",
        "  opacity: 0;",
        "  transition: opacity 0.3s;",
        "  display: flex;",
        "  align-items: flex-end;",
        "}",
        ".gallery-item:hover .gallery-item__overlay { opacity: 1; }",
        ".gallery-item__content { padding: 1.25rem; width: 100%; }",
        ".gallery-item__category {",
        "  display: inline-block;",
        "  background: rgba(37,99,235,0.85);",
        "  color: #fff;",
        "  font-size: 0.6875rem;",
        "  font-weight: 700;",
        "  padding: 0.2rem 0.6rem;",
        "  border-radius: 1rem;",
        "  text-transform: uppercase;",
        "  letter-spacing: 0.04em;",
        "  margin-bottom: 0.5rem;",
        "}",
        ".gallery-item__title {",
        "  font-size: 0.9375rem;",
        "  font-weight: 700;",
        "  color: #fff;",
        "  margin: 0 0 0.375rem;",
        "  line-height: 1.35;",
        "}",
        ".gallery-item__description {",
        "  font-size: 0.8125rem;",
        "  color: rgba(255,255,255,0.8);",
        "  margin: 0 0 0.75rem;",
        "  line-height: 1.5;",
        "  display: -webkit-box;",
        "  -webkit-line-clamp: 2;",
        "  -webkit-box-orient: vertical;",
        "  overflow: hidden;",
        "}",
        ".gallery-item__specs {",
        "  display: flex;",
        "  flex-wrap: wrap;",
        "  gap: 0.375rem;",
        "  margin-bottom: 0.75rem;",
        "}",
        ".gallery-item__spec {",
        "  background: rgba(255,255,255,0.15);",
        "  border-radius: 0.25rem;",
        "  padding: 0.15rem 0.5rem;",
        "  font-size: 0.6875rem;",
        "}",
        ".gallery-item__spec-key { color: rgba(255,255,255,0.65); margin-right: 0.2rem; }",
        ".gallery-item__spec-value { color: #fff; font-weight: 600; }",
        ".gallery-item__actions {",
        "  display: flex;",
        "  gap: 0.5rem;",
        "}",
        ".gallery-item__view-btn {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 0.375rem;",
        "  padding: 0.4rem 0.875rem;",
        "  background: rgba(255,255,255,0.18);",
        "  color: #fff;",
        "  border: 1px solid rgba(255,255,255,0.3);",
        "  border-radius: 0.375rem;",
        "  font-size: 0.75rem;",
        "  font-weight: 600;",
        "  cursor: pointer;",
        "  transition: background 0.2s;",
        "  backdrop-filter: blur(4px);",
        "}",
        ".gallery-item__view-btn:hover { background: rgba(255,255,255,0.3); }",
        ".gallery-item__download-btn {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  width: 2rem;",
        "  height: 2rem;",
        "  background: rgba(255,255,255,0.18);",
        "  color: #fff;",
        "  border: 1px solid rgba(255,255,255,0.3);",
        "  border-radius: 0.375rem;",
        "  cursor: pointer;",
        "  transition: background 0.2s;",
        "  text-decoration: none;",
        "  backdrop-filter: blur(4px);",
        "}",
        ".gallery-item__download-btn:hover { background: rgba(255,255,255,0.3); }",
        ".gallery-item__info {",
        "  padding: 0.875rem 1rem;",
        "  border-top: 1px solid #f1f5f9;",
        "}",
        ".gallery-item__meta {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  gap: 0.5rem;",
        "}",
        ".gallery-item__location,",
        ".gallery-item__date {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 0.3rem;",
        "  font-size: 0.75rem;",
        "  color: #94a3b8;",
        "}",
        "",
        "/* Load more & gallery stats */",
        ".section-archives-gallery__load-more {",
        "  text-align: center;",
        "  margin-bottom: 3rem;",
        "}",
        ".gallery-load-more {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 0.5rem;",
        "  padding: 0.875rem 2rem;",
        "  border-radius: 0.5rem;",
        "  border: 1.5px solid #2563eb;",
        "  background: transparent;",
        "  color: #2563eb;",
        "  font-size: 0.9375rem;",
        "  font-weight: 600;",
        "  cursor: pointer;",
        "  transition: background 0.2s, color 0.2s;",
        "}",
        ".gallery-load-more:hover { background: #2563eb; color: #fff; }",
        ".gallery-load-more__icon { transition: transform 0.2s; }",
        ".gallery-load-more:hover .gallery-load-more__icon { transform: translateY(2px); }",
        ".section-archives-gallery__stats { margin-top: 2rem; }",
        ".gallery-stats {",
        "  display: grid;",
        "  grid-template-columns: repeat(4, 1fr);",
        "  gap: 1.5rem;",
        "  padding: 2rem;",
        "  background: #f8fafc;",
        "  border-radius: 1rem;",
        "  border: 1px solid #e2e8f0;",
        "}",
        ".gallery-stat { text-align: center; }",
        ".gallery-stat__number {",
        "  font-size: 2rem;",
        "  font-weight: 800;",
        "  color: #2563eb;",
        "  line-height: 1;",
        "  margin-bottom: 0.375rem;",
        "}",
        ".gallery-stat__label {",
        "  font-size: 0.875rem;",
        "  color: #64748b;",
        "  font-weight: 500;",
        "}",
        "@media (max-width: 900px) {",
        "  .section-archives-gallery__grid { grid-template-columns: repeat(2, 1fr); }",
        "  .gallery-stats { grid-template-columns: repeat(2, 1fr); }",
        "}",
        "@media (max-width: 560px) {",
        "  .section-archives-gallery__grid { grid-template-columns: 1fr; }",
        "  .gallery-stats { grid-template-columns: repeat(2, 1fr); }",
        "}",
        ""
      ].join("\n"),
    },
    {
      filePath: "functions.php",
      content: [
        "<?php",
        "/**",
        " * Premium Bikes Theme Functions",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "",
        "define( 'THEME_VERSION', '1.0.0' );",
        "define( 'THEME_DIR', get_template_directory() );",
        "define( 'THEME_URI', get_template_directory_uri() );",
        "",
        "/**",
        " * Theme setup",
        " */",
        "function premium_bikes_setup() {",
        "    add_theme_support( 'title-tag' );",
        "    add_theme_support( 'post-thumbnails' );",
        "    add_theme_support( 'custom-logo', array(",
        "        'height'      => 50,",
        "        'width'       => 200,",
        "        'flex-height' => true,",
        "        'flex-width'  => true,",
        "    ) );",
        "    add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption' ) );",
        "",
        "    register_nav_menus( array(",
        "        'primary' => esc_html__( 'Primary Menu', 'premium-bikes' ),",
        "        'footer'  => esc_html__( 'Footer Menu', 'premium-bikes' ),",
        "    ) );",
        "}",
        "add_action( 'after_setup_theme', 'premium_bikes_setup' );",
        "",
        "/**",
        " * Enqueue styles and scripts",
        " */",
        "function premium_bikes_scripts() {",
        "    // Google Fonts — Inter",
        "    wp_enqueue_style(",
        "        'premium-bikes-google-fonts',",
        "        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',",
        "        array(),",
        "        null",
        "    );",
        "",
        "    // Main stylesheet",
        "    wp_enqueue_style( 'premium-bikes-style', get_stylesheet_uri(), array( 'premium-bikes-google-fonts' ), THEME_VERSION );",
        "",
        "    // Animations",
        "    wp_enqueue_style( 'premium-bikes-animations', THEME_URI . '/assets/css/animations.css', array( 'premium-bikes-style' ), THEME_VERSION );",
        "",
        "    // Main JS",
        "    wp_enqueue_script( 'premium-bikes-main', THEME_URI . '/assets/js/main.js', array(), THEME_VERSION, true );",
        "}",
        "add_action( 'wp_enqueue_scripts', 'premium_bikes_scripts' );",
        "",
        "// Include Customizer settings",
        "require_once THEME_DIR . '/inc/customizer.php';",
        "",
        "// Include theme data",
        "require_once THEME_DIR . '/inc/theme-data.php';",
        "",
      ].join("\n"),
    },
    {
      filePath: "inc/theme-data.php",
      content: [
        "<?php",
        "/**",
        " * Static theme data",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "",
        "function premium_bikes_get_site_config() {",
        "    return array(",
        "        'brand_name'  => 'Premium Bikes',",
        "        'tagline'     => 'Ride the Difference',",
        "        'description' => 'A curated collection of high-performance bicycles for every rider.',",
        "        'nav_links'   => array(",
        "            array( 'label' => 'Home', 'href' => '#home' ),",
        "            array( 'label' => 'Collection', 'href' => '#products' ),",
        "            array( 'label' => 'Stories', 'href' => '#editorial' ),",
        "            array( 'label' => 'About', 'href' => '#about' ),",
        "        ),",
        "        'social_links' => array(",
        "            array( 'label' => 'Instagram', 'href' => '#' ),",
        "            array( 'label' => 'Twitter', 'href' => '#' ),",
        "            array( 'label' => 'YouTube', 'href' => '#' ),",
        "        ),",
        "    );",
        "}",
        "",
        "function premium_bikes_get_products() {",
        "    return array(",
        "        array( 'id' => '1', 'name' => 'Mountain Explorer', 'price' => 1299, 'image' => 'https://loremflickr.com/600/800/mountain,bicycle?lock=1', 'alt' => 'Mountain bike on rocky trail' ),",
        "        array( 'id' => '2', 'name' => 'City Cruiser', 'price' => 899, 'image' => 'https://loremflickr.com/600/800/urban,bicycle?lock=2', 'alt' => 'Urban commuter bike' ),",
        "        array( 'id' => '3', 'name' => 'Speed Racer', 'price' => 2199, 'image' => 'https://loremflickr.com/600/800/road,cycling?lock=3', 'alt' => 'Aerodynamic road bike' ),",
        "        array( 'id' => '4', 'name' => 'Trail Blazer', 'price' => 1599, 'image' => 'https://loremflickr.com/600/800/trail,bicycle?lock=4', 'alt' => 'Full-suspension trail bike' ),",
        "    );",
        "}",
        "",
        "function premium_bikes_get_categories() {",
        "    return array(",
        "        array( 'name' => 'Mountain', 'image' => 'https://loremflickr.com/400/300/mountain,trail?lock=5' ),",
        "        array( 'name' => 'Road', 'image' => 'https://loremflickr.com/400/300/road,cycling?lock=6' ),",
        "        array( 'name' => 'Urban', 'image' => 'https://loremflickr.com/400/300/urban,city?lock=7' ),",
        "        array( 'name' => 'Accessories', 'image' => 'https://loremflickr.com/400/300/bicycle,accessories?lock=8' ),",
        "    );",
        "}",
        "",
        "function premium_bikes_get_articles() {",
        "    return array(",
        "        array(",
        "            'id'        => 1,",
        "            'category'  => 'Gear',",
        "            'title'     => 'The Science Behind Carbon Frames',",
        "            'excerpt'   => 'How carbon fiber technology revolutionizes performance cycling and delivers unmatched strength-to-weight ratios.',",
        "            'image'     => 'https://loremflickr.com/800/600/carbon,bicycle?lock=9',",
        "            'alt'       => 'Carbon fiber close-up',",
        "            'date'      => 'December 15, 2023',",
        "            'tags'      => array( 'Technology', 'Materials', 'Performance' ),",
        "            'read_time' => 7,",
        "            'views'     => 11240,",
        "            'featured'  => true,",
        "        ),",
        "        array(",
        "            'id'        => 2,",
        "            'category'  => 'Culture',",
        "            'title'     => 'Urban Cycling Revolution',",
        "            'excerpt'   => 'Cities around the world are reimagining streets for cyclists, transforming daily commutes into a joy.',",
        "            'image'     => 'https://loremflickr.com/800/600/urban,cycling?lock=10',",
        "            'alt'       => 'City cycling scene',",
        "            'date'      => 'December 10, 2023',",
        "            'tags'      => array( 'Urban', 'Lifestyle', 'Commute' ),",
        "            'read_time' => 5,",
        "            'views'     => 8390,",
        "            'featured'  => false,",
        "        ),",
        "        array(",
        "            'id'        => 3,",
        "            'category'  => 'Routes',",
        "            'title'     => 'Epic Mountain Passes',",
        "            'excerpt'   => 'From the Alps to the Rockies – ten legendary climbs every serious cyclist must conquer.',",
        "            'image'     => 'https://loremflickr.com/800/600/mountain,cycling?lock=11',",
        "            'alt'       => 'Mountain pass road',",
        "            'date'      => 'December 5, 2023',",
        "            'tags'      => array( 'Mountain', 'Routes', 'Adventure' ),",
        "            'read_time' => 9,",
        "            'views'     => 14820,",
        "            'featured'  => false,",
        "        ),",
        "    );",
        "}",
        "",
        "function premium_bikes_get_gallery() {",
        "    return array(",
        "        array(",
        "            'image'         => 'https://loremflickr.com/800/600/workshop,bicycle?lock=12',",
        "            'title'         => 'Carbon Frame Workshop',",
        "            'description'   => 'Our master craftsmen shaping the next generation of carbon fiber frames.',",
        "            'category'      => 'manufacturing',",
        "            'category_name' => 'Manufacturing',",
        "            'location'      => 'Portland, OR',",
        "            'date'          => 'December 2023',",
        "            'specs'         => array( 'Material' => 'T700 Carbon', 'Weight' => '750g', 'Stiffness' => 'Grade A' ),",
        "            'download_url'  => '',",
        "        ),",
        "        array(",
        "            'image'         => 'https://loremflickr.com/800/600/trail,mountain?lock=13',",
        "            'title'         => 'Trail Season 2024',",
        "            'description'   => 'Spring trail conditions at their finest \u2013 testing our enduro line in real terrain.',",
        "            'category'      => 'testing',",
        "            'category_name' => 'Testing',",
        "            'location'      => 'Moab, UT',",
        "            'date'          => 'March 2024',",
        "            'specs'         => array( 'Trail' => 'Slickrock', 'Bike' => 'Enduro Pro', 'Distance' => '40km' ),",
        "            'download_url'  => '',",
        "        ),",
        "        array(",
        "            'image'         => 'https://loremflickr.com/800/600/urban,delivery?lock=14',",
        "            'title'         => 'Urban Fleet Delivery',",
        "            'description'   => 'Delivering our city commuter lineup to partners across the Pacific Northwest.',",
        "            'category'      => 'projects',",
        "            'category_name' => 'Projects',",
        "            'location'      => 'Seattle, WA',",
        "            'date'          => 'November 2023',",
        "            'specs'         => array( 'Units' => '200 bikes', 'Model' => 'Urban GT', 'Time' => '3 weeks' ),",
        "            'download_url'  => '',",
        "        ),",
        "        array(",
        "            'image'         => 'https://loremflickr.com/800/600/factory,assembly?lock=15',",
        "            'title'         => 'ISO-Certified Assembly Line',",
        "            'description'   => 'State-of-the-art assembly facility achieving ISO 9001:2015 certification.',",
        "            'category'      => 'manufacturing',",
        "            'category_name' => 'Manufacturing',",
        "            'location'      => 'Portland, OR',",
        "            'date'          => 'October 2023',",
        "            'specs'         => array( 'Standard' => 'ISO 9001', 'Output' => '500 bikes/mo', 'Area' => '3000m\u00b2' ),",
        "            'download_url'  => '',",
        "        ),",
        "        array(",
        "            'image'         => 'https://loremflickr.com/800/600/inspection,quality?lock=16',",
        "            'title'         => 'Quality Control Process',",
        "            'description'   => 'Every bike passes a 50-point inspection before leaving the facility.',",
        "            'category'      => 'testing',",
        "            'category_name' => 'Testing',",
        "            'location'      => 'Portland, OR',",
        "            'date'          => 'September 2023',",
        "            'specs'         => array( 'Inspection' => '100% units', 'Points' => '50 checks', 'Time' => '2 hours' ),",
        "            'download_url'  => '',",
        "        ),",
        "        array(",
        "            'image'         => 'https://loremflickr.com/800/600/road,race?lock=17',",
        "            'title'         => 'Road Classics Summer Tour',",
        "            'description'   => 'Sponsoring the summer road classics series through three European countries.',",
        "            'category'      => 'projects',",
        "            'category_name' => 'Projects',",
        "            'location'      => 'Toulouse, France',",
        "            'date'          => 'July 2023',",
        "            'specs'         => array( 'Riders' => '120 athletes', 'Stages' => '5 stages', 'Distance' => '750km' ),",
        "            'download_url'  => '',",
        "        ),",
        "    );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "inc/customizer.php",
      content: [
        "<?php",
        "/**",
        " * Customizer settings",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "",
        "function premium_bikes_customize_register( $wp_customize ) {",
        "    // Hero Section",
        "    $wp_customize->add_section( 'premium_bikes_hero', array(",
        "        'title'    => esc_html__( 'Hero Section', 'premium-bikes' ),",
        "        'priority' => 30,",
        "    ) );",
        "",
        "    $wp_customize->add_setting( 'hero_title', array(",
        "        'default'           => 'Ride the Difference',",
        "        'sanitize_callback' => 'sanitize_text_field',",
        "    ) );",
        "    $wp_customize->add_control( 'hero_title', array(",
        "        'label'   => esc_html__( 'Hero Title', 'premium-bikes' ),",
        "        'section' => 'premium_bikes_hero',",
        "        'type'    => 'text',",
        "    ) );",
        "",
        "    $wp_customize->add_setting( 'hero_subtitle', array(",
        "        'default'           => 'Experience the intersection of performance and craftsmanship.',",
        "        'sanitize_callback' => 'sanitize_text_field',",
        "    ) );",
        "    $wp_customize->add_control( 'hero_subtitle', array(",
        "        'label'   => esc_html__( 'Hero Subtitle', 'premium-bikes' ),",
        "        'section' => 'premium_bikes_hero',",
        "        'type'    => 'textarea',",
        "    ) );",
        "",
        "    $wp_customize->add_setting( 'hero_cta_text', array(",
        "        'default'           => 'Explore Collection',",
        "        'sanitize_callback' => 'sanitize_text_field',",
        "    ) );",
        "    $wp_customize->add_control( 'hero_cta_text', array(",
        "        'label'   => esc_html__( 'Hero CTA Text', 'premium-bikes' ),",
        "        'section' => 'premium_bikes_hero',",
        "        'type'    => 'text',",
        "    ) );",
        "}",
        "add_action( 'customize_register', 'premium_bikes_customize_register' );",
        "",
      ].join("\n"),
    },
    {
      filePath: "header.php",
      content: [
        "<?php",
        "/**",
        " * Header template",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "$site_config = premium_bikes_get_site_config();",
        "?>",
        "<!DOCTYPE html>",
        '<html <?php language_attributes(); ?>>',
        "<head>",
        '    <meta charset="<?php bloginfo( \'charset\' ); ?>">',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        "    <?php wp_head(); ?>",
        "</head>",
        '<body <?php body_class(); ?>>',
        "<?php wp_body_open(); ?>",
        "",
        '<a class="skip-to-content" href="#main-content"><?php esc_html_e( \'Skip to content\', \'premium-bikes\' ); ?></a>',
        "",
        '<header class="site-header glass" role="banner" id="home">',
        '    <div class="container">',
        '        <a href="<?php echo esc_url( home_url( \'/\' ) ); ?>" class="site-header__brand">',
        "            <?php echo esc_html( $site_config['brand_name'] ); ?>",
        "        </a>",
        '        <div class="site-header__right">',
        '            <nav class="site-header__nav">',
        "                <?php foreach ( $site_config['nav_links'] as $link ) : ?>",
        "                    <a href=\"<?php echo esc_url( $link['href'] ); ?>\"><?php echo esc_html( $link['label'] ); ?></a>",
        "                <?php endforeach; ?>",
        "            </nav>",
        '            <a href="#products" class="btn-primary"><?php esc_html_e( \'Shop Now\', \'premium-bikes\' ); ?></a>',
        "        </div>",
        "    </div>",
        "</header>",
        "",
      ].join("\n"),
    },
    {
      filePath: "footer.php",
      content: [
        "<?php",
        "/**",
        " * Footer template",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "$site_config = premium_bikes_get_site_config();",
        "?>",
        "",
        "<?php get_template_part( 'template-parts/back-to-top' ); ?>",
        "",
        '<footer class="site-footer" role="contentinfo">',
        '    <div class="container">',
        '        <div class="site-footer__top">',
        '            <div class="site-footer__brand">',
        '                <h2 class="site-footer__brand-name"><?php echo esc_html( $site_config[\'brand_name\'] ); ?></h2>',
        '                <p class="site-footer__brand-desc"><?php echo esc_html( $site_config[\'description\'] ); ?></p>',
        "            </div>",
        '            <div class="site-footer__columns">',
        '                <div class="site-footer__col">',
        '                    <h5 class="site-footer__col-title"><?php esc_html_e( \'Navigation\', \'premium-bikes\' ); ?></h5>',
        "                    <?php foreach ( $site_config['nav_links'] as $link ) : ?>",
        "                        <a href=\"<?php echo esc_url( $link['href'] ); ?>\"><?php echo esc_html( $link['label'] ); ?></a>",
        "                    <?php endforeach; ?>",
        "                </div>",
        '                <div class="site-footer__col">',
        '                    <h5 class="site-footer__col-title"><?php esc_html_e( \'Connect\', \'premium-bikes\' ); ?></h5>',
        "                    <?php foreach ( $site_config['social_links'] as $link ) : ?>",
        "                        <a href=\"<?php echo esc_url( $link['href'] ); ?>\"><?php echo esc_html( $link['label'] ); ?></a>",
        "                    <?php endforeach; ?>",
        "                </div>",
        '                <div class="site-footer__col">',
        '                    <h5 class="site-footer__col-title"><?php esc_html_e( \'Newsletter\', \'premium-bikes\' ); ?></h5>',
        '                    <div class="site-footer__newsletter">',
        '                        <input type="email" placeholder="<?php esc_attr_e( \'Email address\', \'premium-bikes\' ); ?>">',
        '                        <button type="button"><?php esc_html_e( \'Subscribe\', \'premium-bikes\' ); ?></button>',
        "                    </div>",
        "                </div>",
        "            </div>",
        "        </div>",
        '        <div class="site-footer__bottom">',
        '            <p class="site-footer__copy">&copy; <?php echo esc_html( date( \'Y\' ) ); ?> <?php echo esc_html( $site_config[\'brand_name\'] ); ?>. <?php esc_html_e( \'All Rights Reserved.\', \'premium-bikes\' ); ?></p>',
        '            <div class="site-footer__legal">',
        '                <a href="#"><?php esc_html_e( \'Privacy\', \'premium-bikes\' ); ?></a>',
        '                <a href="#"><?php esc_html_e( \'Terms\', \'premium-bikes\' ); ?></a>',
        "            </div>",
        "        </div>",
        "    </div>",
        "</footer>",
        "",
        "<?php wp_footer(); ?>",
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    },
    {
      filePath: "index.php",
      content: [
        "<?php",
        "/**",
        " * Main template — fallback for all non-matched templates",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "get_header();",
        "?>",
        "",
        '<main class="site-main" role="main" id="main-content" style="padding-top: 4rem;">',
        "    <?php if ( have_posts() ) : while ( have_posts() ) : the_post(); ?>",
        '        <article class="container" style="padding: 2rem 0;">',
        "            <h1><?php the_title(); ?></h1>",
        '            <div class="entry-content"><?php the_content(); ?></div>',
        "        </article>",
        "    <?php endwhile; else : ?>",
        '        <div class="container" style="padding: 4rem 0; text-align: center;">',
        "            <p><?php esc_html_e( 'No content found.', 'premium-bikes' ); ?></p>",
        "        </div>",
        "    <?php endif; ?>",
        "</main>",
        "",
        "<?php get_footer(); ?>",
        "",
      ].join("\n"),
    },
    {
      filePath: "front-page.php",
      content: [
        "<?php",
        "/**",
        " * Front page template — landing page composing all sections",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "get_header();",
        "?>",
        "",
        '<main class="site-main" role="main" id="main-content" style="padding-top: 4rem;">',
        "    <?php get_template_part( 'template-parts/hero' ); ?>",
        "",
        '    <section id="products">',
        "        <?php get_template_part( 'template-parts/featured-products' ); ?>",
        "    </section>",
        "",
        "    <?php get_template_part( 'template-parts/categories' ); ?>",
        "",
        '    <section id="editorial">',
        "        <?php get_template_part( 'template-parts/editorial' ); ?>",
        "    </section>",
        "",
        '    <section id="archives">',
        "        <?php get_template_part( 'template-parts/archives-gallery' ); ?>",
        "    </section>",
        "",
        '    <section id="about">',
        "        <?php get_template_part( 'template-parts/about' ); ?>",
        "    </section>",
        "</main>",
        "",
        "<?php get_footer(); ?>",
        "",
      ].join("\n"),
    },
    {
      filePath: "page.php",
      content: [
        "<?php",
        "/**",
        " * Generic page template",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "get_header();",
        "?>",
        "",
        '<main class="site-main" role="main" id="main-content" style="padding-top: 4rem;">',
        "    <?php while ( have_posts() ) : the_post(); ?>",
        '        <article class="container" style="padding: 4rem 0;">',
        "            <h1><?php the_title(); ?></h1>",
        '            <div class="entry-content" style="margin-top: 2rem;"><?php the_content(); ?></div>',
        "        </article>",
        "    <?php endwhile; ?>",
        "</main>",
        "",
        "<?php get_footer(); ?>",
        "",
      ].join("\n"),
    },
    {
      filePath: "404.php",
      content: [
        "<?php",
        "/**",
        " * 404 error page",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "get_header();",
        "?>",
        "",
        '<main class="site-main" role="main" id="main-content" style="padding-top: 4rem;">',
        '    <div class="container" style="padding: 8rem 0; text-align: center;">',
        '        <h1 style="font-size: 6rem; font-weight: 900; color: var(--color-muted-foreground);">404</h1>',
        '        <p style="font-size: 1.25rem; color: var(--color-muted-foreground); margin-top: 1rem;">',
        "            <?php esc_html_e( 'Page not found. The page you are looking for does not exist.', 'premium-bikes' ); ?>",
        "        </p>",
        '        <a href="<?php echo esc_url( home_url( \'/\' ) ); ?>" class="btn-primary" style="margin-top: 2rem;">',
        "            <?php esc_html_e( 'Go Home', 'premium-bikes' ); ?>",
        "        </a>",
        "    </div>",
        "</main>",
        "",
        "<?php get_footer(); ?>",
        "",
      ].join("\n"),
    },
    {
      filePath: "template-parts/hero.php",
      content: [
        "<?php",
        "/**",
        " * Hero section template part",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "",
        "$hero_title    = get_theme_mod( 'hero_title', 'Ride the Difference' );",
        "$hero_subtitle = get_theme_mod( 'hero_subtitle', 'Experience the intersection of performance and craftsmanship. A curated collection for the discerning cyclist.' );",
        "$hero_cta      = get_theme_mod( 'hero_cta_text', 'Explore Collection' );",
        "?>",
        "",
        '<div class="section-hero">',
        '    <div class="container">',
        "        <div class=\"section-hero__bg\" style=\"background-image: linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.7)), url('https://loremflickr.com/1920/1080/cycling,sport?lock=0');\">"  ,
        '            <div class="section-hero__content animate-slide-up">',
        '                <h1 class="section-hero__title"><?php echo esc_html( $hero_title ); ?></h1>',
        '                <p class="section-hero__subtitle"><?php echo esc_html( $hero_subtitle ); ?></p>',
        "            </div>",
        '            <div class="section-hero__cta">',
        '                <a href="#products" class="btn-primary"><?php echo esc_html( $hero_cta ); ?></a>',
        "            </div>",
        "        </div>",
        "    </div>",
        "</div>",
        "",
      ].join("\n"),
    },
    {
      filePath: "template-parts/featured-products.php",
      content: [
        "<?php",
        "/**",
        " * Featured Products section",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "$products = premium_bikes_get_products();",
        "?>",
        "",
        '<div class="section-products">',
        '    <div class="container">',
        '        <div class="section-products__header">',
        "            <div>",
        '                <span class="section-products__label"><?php esc_html_e( \'The Collection\', \'premium-bikes\' ); ?></span>',
        '                <h2 class="section-products__title"><?php esc_html_e( \'Featured Bikes\', \'premium-bikes\' ); ?></h2>',
        "            </div>",
        '            <a href="#" class="section-products__link"><?php esc_html_e( \'View All\', \'premium-bikes\' ); ?></a>',
        "        </div>",
        '        <div class="section-products__grid">',
        "            <?php foreach ( $products as $product ) : ?>",
        '                <div class="product-card">',
        '                    <div class="product-card__image">',
        "                        <img class=\"product-card__img\" src=\"<?php echo esc_url( $product['image'] ); ?>\" alt=\"<?php echo esc_attr( $product['alt'] ); ?>\" loading=\"lazy\">",
        "                    </div>",
        "                    <div>",
        "                        <p class=\"product-card__name\"><?php echo esc_html( $product['name'] ); ?></p>",
        "                        <p class=\"product-card__price\">$<?php echo esc_html( number_format( $product['price'] ) ); ?></p>",
        "                    </div>",
        "                </div>",
        "            <?php endforeach; ?>",
        "        </div>",
        "    </div>",
        "</div>",
        "",
      ].join("\n"),
    },
    {
      filePath: "template-parts/categories.php",
      content: [
        "<?php",
        "/**",
        " * Categories section",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "$categories = premium_bikes_get_categories();",
        "?>",
        "",
        '<div class="section-categories">',
        '    <div class="container">',
        '        <h2 class="section-categories__title"><?php esc_html_e( \'Categories\', \'premium-bikes\' ); ?></h2>',
        '        <div class="section-categories__grid">',
        "            <?php foreach ( $categories as $cat ) : ?>",
        '                <div class="category-card">',
        '                    <div class="category-card__overlay"></div>',
        "                    <img class=\"category-card__img\" src=\"<?php echo esc_url( $cat['image'] ); ?>\" alt=\"<?php echo esc_attr( $cat['name'] ); ?>\" loading=\"lazy\">",
        '                    <div class="category-card__label"><?php echo esc_html( $cat[\'name\'] ); ?></div>',
        "                </div>",
        "            <?php endforeach; ?>",
        "        </div>",
        "    </div>",
        "</div>",
        "",
      ].join("\n"),
    },
    {
      filePath: "template-parts/editorial.php",
      content: [
        "<?php",
        "/**",
        " * Editorial section",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "$articles = premium_bikes_get_articles();",
        "$featured_article = array_shift( $articles );",
        "?>",
        "",
        '<section class="section-editorial" id="editorial">',
        '    <div class="container">',
        '        <div class="section-editorial__header" data-aos="fade-up">',
        '            <div class="section-editorial__badge">',
        "                <?php esc_html_e( 'Knowledge & Technology', 'premium-bikes' ); ?>",
        "            </div>",
        '            <h2 class="section-editorial__title">',
        "                <?php esc_html_e( 'Cycling Knowledge Hub', 'premium-bikes' ); ?>",
        "            </h2>",
        '            <p class="section-editorial__description">',
        "                <?php esc_html_e( 'Deep dives into bike technology, routes, and cycling culture from our team of experts.', 'premium-bikes' ); ?>",
        "            </p>",
        "        </div>",
        "",
        "        <?php if ( \$featured_article ) : ?>",
        '        <div class="section-editorial__featured" data-aos="fade-up" data-aos-delay="200">',
        '            <article class="featured-article">',
        '                <div class="featured-article__image">',
        "                    <img",
        "                        src=\"<?php echo esc_url( \$featured_article['image'] ); ?>\"",
        "                        alt=\"<?php echo esc_attr( \$featured_article['title'] ); ?>\"",
        '                        class="featured-article__img"',
        "                        loading=\"lazy\"",
        "                    >",
        '                    <div class="featured-article__overlay">',
        '                        <div class="featured-article__meta">',
        '                            <span class="featured-article__category">',
        "                                <?php echo esc_html( \$featured_article['category'] ); ?>",
        "                            </span>",
        '                            <span class="featured-article__date">',
        "                                <?php echo esc_html( \$featured_article['date'] ); ?>",
        "                            </span>",
        "                        </div>",
        "                    </div>",
        "                </div>",
        '                <div class="featured-article__content">',
        '                    <div class="featured-article__tags">',
        "                        <?php foreach ( \$featured_article['tags'] as \$tag ) : ?>",
        '                            <span class="featured-article__tag"><?php echo esc_html( \$tag ); ?></span>',
        "                        <?php endforeach; ?>",
        "                    </div>",
        '                    <h3 class="featured-article__title">',
        "                        <?php echo esc_html( \$featured_article['title'] ); ?>",
        "                    </h3>",
        '                    <p class="featured-article__excerpt">',
        "                        <?php echo esc_html( \$featured_article['excerpt'] ); ?>",
        "                    </p>",
        '                    <div class="featured-article__stats">',
        '                        <div class="featured-article__stat">',
        '                            <svg class="featured-article__stat-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',
        "                            <span><?php echo esc_html( \$featured_article['read_time'] ); ?> min read</span>",
        "                        </div>",
        '                        <div class="featured-article__stat">',
        '                            <svg class="featured-article__stat-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        "                            <span><?php echo esc_html( number_format( \$featured_article['views'] ) ); ?> views</span>",
        "                        </div>",
        "                    </div>",
        '                    <div class="featured-article__actions">',
        '                        <a href="#" class="btn-primary">',
        "                            <?php esc_html_e( 'Read Article', 'premium-bikes' ); ?>",
        "                        </a>",
        '                        <button class="featured-article__bookmark" aria-label="<?php esc_attr_e( \'Save article\', \'premium-bikes\' ); ?>">',
        '                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
        "                        </button>",
        "                    </div>",
        "                </div>",
        "            </article>",
        "        </div>",
        "        <?php endif; ?>",
        "",
        '        <div class="section-editorial__grid" data-aos="fade-up" data-aos-delay="400">',
        "            <?php foreach ( \$articles as \$index => \$article ) : ?>",
        '                <article class="article-card" data-aos="slide-up" data-aos-delay="<?php echo esc_attr( 100 + ( \$index * 100 ) ); ?>">',
        '                    <div class="article-card__image">',
        "                        <img",
        "                            src=\"<?php echo esc_url( \$article['image'] ); ?>\"",
        "                            alt=\"<?php echo esc_attr( \$article['alt'] ); ?>\"",
        '                            class="article-card__img"',
        "                            loading=\"lazy\"",
        "                        >",
        '                        <div class="article-card__overlay">',
        "                            <span class=\"article-card__category\"><?php echo esc_html( $article['category'] ); ?></span>",
        "                        </div>",
        "                    </div>",
        '                    <div class="article-card__content">',
        '                        <div class="article-card__meta">',
        "                            <span class=\"article-card__date\"><?php echo esc_html( $article['date'] ); ?></span>",
        '                            <span class="article-card__separator">&bull;</span>',
        "                            <span class=\"article-card__read-time\"><?php echo esc_html( $article['read_time'] ); ?> min</span>",
        "                        </div>",
        "                        <h3 class=\"article-card__title\"><?php echo esc_html( $article['title'] ); ?></h3>",
        "                        <p class=\"article-card__excerpt\"><?php echo esc_html( $article['excerpt'] ); ?></p>",
        '                        <div class="article-card__tags">',
        "                            <?php foreach ( \$article['tags'] as \$tag ) : ?>",
        '                                <span class="article-card__tag"><?php echo esc_html( \$tag ); ?></span>',
        "                            <?php endforeach; ?>",
        "                        </div>",
        '                        <div class="article-card__footer">',
        '                            <a href="#" class="article-card__link">',
        "                                <?php esc_html_e( 'Read More', 'premium-bikes' ); ?>",
        '                                <svg class="article-card__link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>',
        "                            </a>",
        '                            <span class="article-card__views">',
        '                                <svg class="article-card__views-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        "                                <?php echo esc_html( number_format( \$article['views'] ) ); ?>",
        "                            </span>",
        "                        </div>",
        "                    </div>",
        "                </article>",
        "            <?php endforeach; ?>",
        "        </div>",
        "",
        '        <div class="section-editorial__newsletter" data-aos="fade-up" data-aos-delay="600">',
        '            <div class="newsletter-signup">',
        '                <div class="newsletter-signup__content">',
        '                    <div class="newsletter-signup__icon">',
        '                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
        "                    </div>",
        '                    <h3 class="newsletter-signup__title">',
        "                        <?php esc_html_e( 'Stay in the Loop', 'premium-bikes' ); ?>",
        "                    </h3>",
        '                    <p class="newsletter-signup__description">',
        "                        <?php esc_html_e( 'Get the latest articles, gear reviews, and route guides delivered to your inbox.', 'premium-bikes' ); ?>",
        "                    </p>",
        "                </div>",
        '                <form class="newsletter-signup__form" method="post" action="">',
        "                    <?php wp_nonce_field( 'newsletter_signup', 'newsletter_nonce' ); ?>",
        '                    <div class="newsletter-signup__input-group">',
        "                        <input",
        "                            type=\"email\"",
        "                            name=\"newsletter_email\"",
        '                            class="newsletter-signup__input"',
        "                            placeholder=\"<?php esc_attr_e( 'Your email address', 'premium-bikes' ); ?>\"",
        "                            required",
        "                            autocomplete=\"email\"",
        "                        >",
        '                        <button type="submit" class="newsletter-signup__btn btn-primary">',
        "                            <?php esc_html_e( 'Subscribe', 'premium-bikes' ); ?>",
        "                        </button>",
        "                    </div>",
        '                    <p class="newsletter-signup__privacy">',
        "                        <?php esc_html_e( 'No spam, unsubscribe at any time. See our ', 'premium-bikes' ); ?>",
        '                        <a href="#privacy-policy" class="newsletter-signup__privacy-link">',
        "                            <?php esc_html_e( 'privacy policy', 'premium-bikes' ); ?>",
        "                        </a>",
        "                    </p>",
        "                </form>",
        "            </div>",
        "        </div>",
        "    </div>",
        "</section>",
        "",
      ].join("\n"),
    },
    {
      filePath: "template-parts/archives-gallery.php",
      content: [
        "<?php",
        "/**",
        " * Archives gallery section",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "$gallery_items = premium_bikes_get_gallery();",
        "?>",
        "",
        '<section class="section-archives-gallery" id="gallery">',
        '    <div class="container">',
        '        <div class="section-archives-gallery__header" data-aos="fade-up">',
        '            <div class="section-archives-gallery__badge">',
        "                <?php esc_html_e( 'Gallery', 'premium-bikes' ); ?>",
        "            </div>",
        '            <h2 class="section-archives-gallery__title">',
        "                <?php esc_html_e( 'Bikes in the Real World', 'premium-bikes' ); ?>",
        "            </h2>",
        '            <p class="section-archives-gallery__description">',
        "                <?php esc_html_e( 'From our workshop to the trail – a behind-the-scenes look at Premium Bikes in action.', 'premium-bikes' ); ?>",
        "            </p>",
        "        </div>",
        "",
        '        <div class="section-archives-gallery__filters" data-aos="fade-up" data-aos-delay="200">',
        '            <button class="gallery-filter gallery-filter--active" data-filter="all">',
        "                <?php esc_html_e( 'All', 'premium-bikes' ); ?>",
        "            </button>",
        '            <button class="gallery-filter" data-filter="manufacturing">',
        "                <?php esc_html_e( 'Manufacturing', 'premium-bikes' ); ?>",
        "            </button>",
        '            <button class="gallery-filter" data-filter="testing">',
        "                <?php esc_html_e( 'Testing', 'premium-bikes' ); ?>",
        "            </button>",
        '            <button class="gallery-filter" data-filter="projects">',
        "                <?php esc_html_e( 'Projects', 'premium-bikes' ); ?>",
        "            </button>",
        "        </div>",
        "",
        '        <div class="section-archives-gallery__grid" data-aos="fade-up" data-aos-delay="400">',
        "            <?php foreach ( \$gallery_items as \$index => \$item ) : ?>",
        "                <div class=\"gallery-item\" data-category=\"<?php echo esc_attr( \$item['category'] ); ?>\">",
        '                    <div class="gallery-item__image-wrapper">',
        "                        <img",
        "                            src=\"<?php echo esc_url( \$item['image'] ); ?>\"",
        "                            alt=\"<?php echo esc_attr( \$item['title'] ); ?>\"",
        '                            class="gallery-item__image"',
        "                            loading=\"lazy\"",
        "                        >",
        '                        <div class="gallery-item__overlay">',
        '                            <div class="gallery-item__content">',
        '                                <div class="gallery-item__category">',
        "                                    <?php echo esc_html( \$item['category_name'] ); ?>",
        "                                </div>",
        "                                <h3 class=\"gallery-item__title\"><?php echo esc_html( $item['title'] ); ?></h3>",
        "                                <p class=\"gallery-item__description\"><?php echo esc_html( $item['description'] ); ?></p>",
        "                                <div class=\"gallery-item__specs\">",
        "                                    <?php foreach ( $item['specs'] as $key => $val ) : ?>",
        "                                        <div class=\"gallery-item__spec\">",
        "                                            <span class=\"gallery-item__spec-key\"><?php echo esc_html( $key ); ?>:</span>",
        "                                            <span class=\"gallery-item__spec-value\"><?php echo esc_html( $val ); ?></span>",
        "                                        </div>",
        "                                    <?php endforeach; ?>",
        "                                </div>",
        '                                <div class="gallery-item__actions">',
        "                                    <button class=\"gallery-item__view-btn\">",
        '                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        "                                        <?php esc_html_e( 'View', 'premium-bikes' ); ?>",
        "                                    </button>",
        "                                </div>",
        "                            </div>",
        "                        </div>",
        "                    </div>",
        '                    <div class="gallery-item__info">',
        '                        <div class="gallery-item__meta">',
        '                            <span class="gallery-item__location">',
        '                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
        "                                <?php echo esc_html( \$item['location'] ); ?>",
        "                            </span>",
        '                            <span class="gallery-item__date">',
        "                                <?php echo esc_html( \$item['date'] ); ?>",
        "                            </span>",
        "                        </div>",
        "                    </div>",
        "                </div>",
        "            <?php endforeach; ?>",
        "        </div>",
        "",
        '        <div class="section-archives-gallery__load-more" data-aos="fade-up" data-aos-delay="600">',
        '            <button class="gallery-load-more btn-outline">',
        "                <?php esc_html_e( 'Load More', 'premium-bikes' ); ?>",
        '                <svg class="gallery-load-more__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 12,15 18,9"/></svg>',
        "            </button>",
        "        </div>",
        "",
        '        <div class="section-archives-gallery__stats" data-aos="fade-up" data-aos-delay="800">',
        '            <div class="gallery-stats">',
        '                <div class="gallery-stat"><div class="gallery-stat__number">500+</div><div class="gallery-stat__label"><?php esc_html_e( \'Bikes Sold\', \'premium-bikes\' ); ?></div></div>',
        '                <div class="gallery-stat"><div class="gallery-stat__number">50+</div><div class="gallery-stat__label"><?php esc_html_e( \'Partners\', \'premium-bikes\' ); ?></div></div>',
        '                <div class="gallery-stat"><div class="gallery-stat__number">24/7</div><div class="gallery-stat__label"><?php esc_html_e( \'Support\', \'premium-bikes\' ); ?></div></div>',
        '                <div class="gallery-stat"><div class="gallery-stat__number">10+</div><div class="gallery-stat__label"><?php esc_html_e( \'Years Experience\', \'premium-bikes\' ); ?></div></div>',
        "            </div>",
        "        </div>",
        "    </div>",
        "</section>",
        "",
      ].join("\n"),
    },
    {
      filePath: "template-parts/about.php",
      content: [
        "<?php",
        "/**",
        " * About section",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "$site_config = premium_bikes_get_site_config();",
        "?>",
        "",
        '<div class="section-about">',
        '    <div class="container">',
        '        <div class="section-about__grid">',
        '            <div class="section-about__image">',
        "                <img src=\"https://loremflickr.com/800/800/workshop,craftsman?lock=18\" alt=\"<?php esc_attr_e( 'About us', 'premium-bikes' ); ?>\" loading=\"lazy\">",
        "            </div>",
        "            <div>",
        '                <span class="section-about__label"><?php esc_html_e( \'Our Story\', \'premium-bikes\' ); ?></span>',
        '                <h2 class="section-about__heading"><?php esc_html_e( \'Built for Those Who Ride.\', \'premium-bikes\' ); ?></h2>',
        '                <div class="section-about__text">',
        "                    <p><?php echo esc_html( $site_config['description'] ); ?></p>",
        "                    <p><?php esc_html_e( 'Every bike we curate reflects our commitment to performance, durability, and the pure joy of cycling.', 'premium-bikes' ); ?></p>",
        "                </div>",
        '                <div class="section-about__stats">',
        "                    <div>",
        '                        <h4 class="stat__number">500+</h4>',
        '                        <p class="stat__label"><?php esc_html_e( \'Bikes curated\', \'premium-bikes\' ); ?></p>',
        "                    </div>",
        "                    <div>",
        '                        <h4 class="stat__number">10k+</h4>',
        '                        <p class="stat__label"><?php esc_html_e( \'Happy riders\', \'premium-bikes\' ); ?></p>',
        "                    </div>",
        "                </div>",
        "            </div>",
        "        </div>",
        "    </div>",
        "</div>",
        "",
      ].join("\n"),
    },
    {
      filePath: "template-parts/back-to-top.php",
      content: [
        "<?php",
        "/**",
        " * Back to top button",
        " *",
        " * @package Premium_Bikes",
        " */",
        "",
        "if ( ! defined( 'ABSPATH' ) ) { exit; }",
        "?>",
        "",
        '<button class="back-to-top" id="back-to-top" aria-label="<?php esc_attr_e( \'Back to top\', \'premium-bikes\' ); ?>">',
        '    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
        "</button>",
        "",
      ].join("\n"),
    },
    {
      filePath: "assets/css/animations.css",
      content: [
        "/* Animations — respects prefers-reduced-motion (WCAG 2.1 SC 2.3.3) */",
        "@media (prefers-reduced-motion: no-preference) {",
        "  @keyframes fade-in {",
        "    from { opacity: 0; }",
        "    to { opacity: 1; }",
        "  }",
        "  @keyframes slide-up {",
        "    from { opacity: 0; transform: translateY(20px); }",
        "    to { opacity: 1; transform: translateY(0); }",
        "  }",
        "  @keyframes slide-in-left {",
        "    from { opacity: 0; transform: translateX(-20px); }",
        "    to { opacity: 1; transform: translateX(0); }",
        "  }",
        "  .animate-fade-in { animation: fade-in 0.6s ease-out forwards; }",
        "  .animate-slide-up { animation: slide-up 0.6s ease-out forwards; }",
        "  .animate-slide-in-left { animation: slide-in-left 0.6s ease-out forwards; }",
        "}",
        "",
        "/* Blanket override for users who prefer no motion */",
        "@media (prefers-reduced-motion: reduce) {",
        "  *, *::before, *::after {",
        "    animation-duration: 0.01ms !important;",
        "    animation-iteration-count: 1 !important;",
        "    transition-duration: 0.01ms !important;",
        "    scroll-behavior: auto !important;",
        "  }",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "assets/js/main.js",
      content: [
        "/**",
        " * Premium Bikes — Frontend JS",
        " */",
        "(function () {",
        "    'use strict';",
        "",
        "    // Back to top button",
        "    var btn = document.getElementById('back-to-top');",
        "    if (btn) {",
        "        btn.addEventListener('click', function () {",
        "            window.scrollTo({ top: 0, behavior: 'smooth' });",
        "        });",
        "        window.addEventListener('scroll', function () {",
        "            btn.style.display = window.scrollY > 300 ? 'flex' : 'none';",
        "        });",
        "        btn.style.display = 'none';",
        "    }",
        "",
        "    // Mobile menu toggle (placeholder for future enhancement)",
        "    var menuToggle = document.getElementById('mobile-menu-toggle');",
        "    var mobileNav = document.getElementById('mobile-nav');",
        "    if (menuToggle && mobileNav) {",
        "        menuToggle.addEventListener('click', function () {",
        "            mobileNav.classList.toggle('is-open');",
        "        });",
        "    }",
        "})();",
        "",
      ].join("\n"),
    },
  ];

  // Apply brand name + slug replacement to ALL file contents in one pass
  return files.map((f) => ({ ...f, content: brand(f.content) }));
}

function mockBuildFix(): BuildFixResponse {
  return {
    fixes: [
      {
        filePath: "functions.php",
        content: [
          "<?php",
          "if ( ! defined( 'ABSPATH' ) ) { exit; }",
          "define( 'THEME_VERSION', '1.0.0' );",
          "// Fixed theme setup",
        ].join("\n"),
      },
    ],
    explanation: "Fixed PHP syntax error in functions.php",
  };
}

function mockCommitMsg(): CommitMessageResponse {
  return {
    message: "feat: initial WordPress theme with editorial landing page layout",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  AGENT 1 — IDEA ANALYZER
// ═════════════════════════════════════════════════════════════════════════════

async function ideaAnalyzer(ctx: SharedContext): Promise<AgentResult<FeatureAnalysis>> {
  try {
    const prompt = `[ANALYZE_IDEA]
Analyze the following web application idea and produce a thorough requirements document.

Idea: "${ctx.idea}"

Respond with JSON matching this exact shape:
{
  "projectName": "kebab-case-slug (ASCII only, no diacritics)",
  "brandName": "Human-readable brand/company name extracted from the idea (e.g. 'Hoàng Long', 'TechStore')",
  "summary": "One-sentence project summary",
  "targetAudience": "Who the site is designed for (age group, interests, intent)",
  "goals": [
    "Business/UX goal 1",
    "Business/UX goal 2"
  ],
  "features": [
    {
      "name": "Feature name",
      "description": "What this section does and why it matters",
      "priority": "high | medium | low",
      "acceptanceCriteria": [
        "Specific, testable criterion 1",
        "Specific, testable criterion 2"
      ]
    }
  ],
  "userStories": [
    {
      "role": "visitor | shopper | returning customer | admin",
      "goal": "I want to ...",
      "rationale": "so that ..."
    }
  ],
  "designDirection": {
    "tone": "e.g. bold, minimalist, energetic, trustworthy",
    "colorPalette": "e.g. dark navy + electric indigo + warm white",
    "typography": "e.g. heavy display font for headlines, clean sans-serif for body",
    "inspiration": ["Brand or site reference 1", "Brand or site reference 2"]
  },
  "nonFunctionalRequirements": {
    "performance": ["Requirement 1", "Requirement 2"],
    "accessibility": ["WCAG 2.1 AA compliance", "Requirement 2"],
    "seo": ["Requirement 1", "Requirement 2"]
  },
  "contentRequirements": [
    "Type of content needed (e.g. product photos, editorial articles, brand copy)"
  ],
  "techStack": {
    "frontend": ["PHP", "WordPress", "CSS3", "Vanilla JS"],
    "backend": ["WordPress", "PHP"],
    "devtools": ["php", "wp-cli"]
  }
}

Rules:
- Map the idea into 6–8 features covering: Hero, Featured Products, Categories, Editorial/Blog, Archives/Gallery, About, Footer.
- Write 4–6 goals that are measurable (conversion rate, engagement, etc.).
- Write 5–8 user stories covering the main journeys (discovery, browsing, purchasing intent, brand trust).
- Each feature must have 2–3 acceptance criteria (specific, testable).
- Design direction should be tailored to the topic/brand feel.
- Non-functional requirements: 2–3 per category.
- Content requirements: list 4–6 distinct content types needed.
- Always use WordPress + PHP + CSS3 as tech stack.`;

    const result = (await callLLM(prompt)) as FeatureAnalysis;
    ctx.analysis = result;
    log("INFO", `Analysis complete: ${result.features.length} features identified`);
    return { success: true, data: result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: null as never, error: msg };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  AGENT 2 — SPEC BUILDER
// ═════════════════════════════════════════════════════════════════════════════

async function specBuilder(ctx: SharedContext): Promise<AgentResult<ProjectSpec>> {
  try {
    const prompt = `[BUILD_SPEC]
Create a detailed project specification for a WordPress theme.

Analysis:
${JSON.stringify(ctx.analysis, null, 2)}

${DESIGN_SYSTEM}
${WP_SECURITY_RULES}

Respond with JSON:
{
  "architecture": "WordPress Theme with template parts, Customizer API, and vanilla CSS/JS",
  "fileStructure": [
    { "filePath": "relative/path/file.php", "description": "Purpose" }
  ],
  "apiEndpoints": [],
  "buildScript": "php -l *.php inc/*.php template-parts/*.php",
  "testScript": "php -l *.php inc/*.php template-parts/*.php"
}

${REQUIRED_FILE_STRUCTURE}

Do NOT include test files.
Do NOT include any Node.js, Vite, Next.js, React, or Tailwind files.
This is a pure WordPress PHP theme with WCAG 2.1 AA accessibility and WordPress security best practices.`;

    const result = (await callLLM(prompt)) as ProjectSpec;
    ctx.spec = result;
    log("INFO", `Spec complete: ${result.fileStructure.length} files planned`);
    return { success: true, data: result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: null as never, error: msg };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  AGENT 3 — CODE GENERATOR
// ═════════════════════════════════════════════════════════════════════════════

async function codeGenerator(ctx: SharedContext): Promise<AgentResult<GeneratedFile[]>> {
  try {
    const spec = ctx.spec!;

    // Sort: core → inc → templates → template-parts → assets (ensures core theme files exist first)
    const priorityOrder = (fp: string): number => {
      if (fp === "style.css") return 0;
      if (fp === "functions.php") return 1;
      if (fp.includes("inc/")) return 2;
      if (fp === "header.php" || fp === "footer.php") return 3;
      if (fp === "front-page.php" || fp === "index.php" || fp === "page.php" || fp === "single.php" || fp === "404.php" || fp === "archive.php") return 4;
      if (fp.includes("template-parts/")) return 5;
      if (fp.includes("assets/")) return 6;
      return 5;
    };
    // Filter out binary files — LLM cannot generate them
    const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".eot"]);
    const allPlannedRaw = [...spec.fileStructure].sort((a, b) => priorityOrder(a.filePath) - priorityOrder(b.filePath));
    const binaryFiles = allPlannedRaw.filter((f) => BINARY_EXTS.has(path.extname(f.filePath).toLowerCase()));
    const allPlanned = allPlannedRaw.filter((f) => !BINARY_EXTS.has(path.extname(f.filePath).toLowerCase()));
    const BATCH_SIZE = 4;
    const allFiles: GeneratedFile[] = [];

    // Generate placeholder for binary files (e.g. screenshot.png)
    for (const bf of binaryFiles) {
      if (bf.filePath === "screenshot.png") {
        // Create a 1x1 transparent PNG placeholder
        const pngPlaceholder = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64"
        );
        await fs.mkdir(ctx.workspacePath, { recursive: true });
        await fs.writeFile(path.join(ctx.workspacePath, bf.filePath), pngPlaceholder);
        log("INFO", `Generated placeholder: ${bf.filePath}`);
      } else {
        log("WARN", `Skipping binary file: ${bf.filePath}`);
      }
    }

    // Split files into batches to avoid truncated LLM responses
    const batches: FileSpec[][] = [];
    for (let i = 0; i < allPlanned.length; i += BATCH_SIZE) {
      batches.push(allPlanned.slice(i, i + BATCH_SIZE));
    }

    log("INFO", `Generating code in ${batches.length} batch(es) for ${allPlanned.length} files`);

    // Always generate package.json + config files first (batch 0)
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const fileList = batch.map((f) => `  - ${f.filePath}: ${f.description}`).join("\n");

      // Provide already-generated files as context so imports/deps stay consistent
      // Prioritize showing type definitions and data files in full (they define the contract)
      const existingContext =
        allFiles.length > 0
          ? `\nAlready generated files (use these for reference — do NOT regenerate them):\n${allFiles.map((f) => {
              const isTypeOrData = f.filePath.includes("types/") || f.filePath.includes("data/");
              const limit = isTypeOrData ? 2000 : 500;
              return `--- ${f.filePath} ---\n${f.content.slice(0, limit)}${f.content.length > limit ? "\n…(truncated)" : ""}`;
            }).join("\n")}\n`
          : "";

      const prompt = `[GENERATE_CODE]
Generate beautiful, production-quality WordPress theme code for a landing page.

BE CREATIVE with the visual design — make it stunning, modern, and unique.
The design should feel premium and polished, with thoughtful use of color, typography, and spacing.

Project slug : ${ctx.analysis?.projectName}
Brand name   : ${ctx.analysis?.brandName ?? ctx.idea}
User's idea  : "${ctx.idea}"
Full project file list: ${allPlanned.map((f) => f.filePath).join(", ")}

⚠️  BRAND & CONTENT RULES — follow exactly:
- Theme Name in style.css header comment MUST be: "${ctx.analysis?.brandName ?? ctx.analysis?.projectName}"
- Text Domain MUST be: "${ctx.analysis?.projectName}"
- All PHP function prefixes MUST use: "${(ctx.analysis?.projectName ?? "theme").replace(/-/g, "_")}_"
- The brand/company name shown in header, footer, and all copy IS: "${ctx.analysis?.brandName ?? ctx.idea}"
- ALL product names, categories, articles, hero copy, about text MUST relate to: "${ctx.idea}"
- Do NOT use "Premium Bikes", "bikes", "bicycle", or any unrelated placeholder topic
- Use loremflickr.com for ALL images: https://loremflickr.com/{width}/{height}/{keyword1},{keyword2}?lock={n}
  Keywords MUST relate to the theme topic (e.g. battery,energy for a battery store). Use different ?lock=N per item.

${DESIGN_SYSTEM}
${WP_SECURITY_RULES}
${existingContext}
Generate ONLY these files (batch ${batchIdx + 1}/${batches.length}):
${fileList}

Respond with a JSON array:
[
  { "filePath": "<exact path>", "content": "<full file content>" }
]

CRITICAL rules (violating these causes errors):
- This is a WordPress theme — ALL template files must be PHP
- style.css MUST start with the WordPress theme header comment (/* Theme Name: "${ctx.analysis?.brandName ?? ctx.analysis?.projectName}" */)
- functions.php MUST start with <?php and use WordPress hooks properly
- ALWAYS check if ( ! defined( 'ABSPATH' ) ) { exit; } at the top of PHP files
- Use proper WordPress escaping: esc_html(), esc_attr(), esc_url(), wp_kses_post() — escape at the point of output
- Use i18n functions: __(), _e(), esc_html__(), esc_html_e() with the theme text domain
- Use get_template_part() to include template parts, NOT include/require
- Use wp_enqueue_style/script() in functions.php — do NOT add <link>/<script> tags directly
- header.php must include wp_head() before </head> and wp_body_open() after <body>
- header.php must have <a class="skip-to-content" href="#main-content">Skip to content</a> as first body element
- footer.php must include wp_footer() before </body>
- Use register_nav_menus() for navigation, wp_nav_menu() to display — do NOT create custom Walker classes
- Use get_theme_mod() for Customizer settings
- inc/theme-data.php MUST define EXACTLY these 5 functions (no more, no fewer):
    {prefix}_get_site_config(), {prefix}_get_products(), {prefix}_get_categories(), {prefix}_get_articles(), {prefix}_get_gallery()
  Template parts may ONLY call those 5 functions — do NOT invent extra functions like get_hero_data(), get_features(), get_stats()
- CSS should use BEM naming (.section-hero, .section-hero__title, .section-hero--large)
- CSS must use CSS custom properties (var(--color-primary)) for theming
- All animations/transitions must be wrapped in @media (prefers-reduced-motion: no-preference) { }
- All :hover effects must also have equivalent :focus-visible styles for keyboard accessibility
- Every <img> must have a descriptive alt="" attribute
- Semantic HTML: use <main id="main-content">, <nav aria-label>, <header role="banner">, <footer role="contentinfo">
- No React, No JSX, No TypeScript, No Tailwind, No Next.js
- For images: use <img> tags or inline style="background-image: url('...')" with loremflickr.com URLs — always use keywords matching the theme topic
- Every file must be COMPLETE — no TODOs, no placeholders, no "..." shortcuts
- Do NOT use WooCommerce APIs, WooCommerce functions, WC(), wc_get_cart_url(), cart, checkout, or plugin-dependent code unless the user's idea explicitly requests WooCommerce.
- Generated themes must run in a plain local PHP preview/router without any WordPress plugins active.
- NEVER call WC()->cart directly.
- If WooCommerce support is explicitly required, always guard it:
  function_exists('WC') && WC() && isset(WC()->cart) && is_object(WC()->cart)
- If WooCommerce is unavailable, hide cart/checkout UI instead of throwing errors.
- Return ONLY the ${batch.length} file(s) listed above`;

      log("INFO", `Batch ${batchIdx + 1}/${batches.length}: generating ${batch.map((f) => f.filePath).join(", ")}`);

      let batchFiles: GeneratedFile[];
      try {
        batchFiles = (await callLLM(prompt, 32000)) as GeneratedFile[];
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("truncated") && batch.length > 1) {
          // Truncation: retry files one-by-one
          log("WARN", `Batch ${batchIdx + 1} truncated — retrying ${batch.length} files individually`);
          batchFiles = [];
          for (const singleFile of batch) {
            const singlePrompt = prompt
              .replace(/Generate ONLY these files \(batch .*?\):\n[\s\S]*?\nRespond/,
                `Generate ONLY this file:\n  - ${singleFile.filePath}: ${singleFile.description}\n\nRespond`)
              .replace(/Return ONLY the \d+ file\(s\) listed above/,
                `Return ONLY 1 file: ${singleFile.filePath}`);
            log("INFO", `  Retrying individually: ${singleFile.filePath}`);
            try {
              const singleResult = (await callLLM(singlePrompt, 16384)) as GeneratedFile[] | GeneratedFile;
              const files = Array.isArray(singleResult) ? singleResult : [singleResult];
              batchFiles.push(...files);
              allFiles.push(...files);
            } catch (singleErr: unknown) {
              const singleMsg = singleErr instanceof Error ? singleErr.message : String(singleErr);
              log("ERROR", `  Failed to generate ${singleFile.filePath}: ${singleMsg}`);
            }
            await sleep(5000);
          }
          log("INFO", `Batch ${batchIdx + 1} done (individual mode): ${batchFiles.length} files received`);
          continue;
        }
        throw err; // Re-throw non-truncation errors
      }
      allFiles.push(...batchFiles);

      log("INFO", `Batch ${batchIdx + 1} done: ${batchFiles.length} files received`);

      // Rate limit cooldown between batches
      if (batchIdx < batches.length - 1) {
        log("DEBUG", "Waiting 10s between batches (rate limit cooldown)…");
        await sleep(10_000);
      }
    }

    ctx.generatedFiles = allFiles;

    await fs.mkdir(ctx.workspacePath, { recursive: true });
    for (const f of allFiles) {
      await writeFileSafe(ctx.workspacePath, f.filePath, f.content);
    }

    log("INFO", `Code generated: ${allFiles.length} files written to ${ctx.workspacePath}`);
    return { success: true, data: allFiles };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: null as never, error: msg };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  RUNTIME CHECK — Start dev server, fetch pages, capture errors
// ═════════════════════════════════════════════════════════════════════════════

interface RuntimeCheckResult {
  success: boolean;
  errors: string[];
  serverOutput: string;
}

/** Generate the .router.php content for PHP built-in server (WordPress stubs) */
function generateRouterContent(port: number): string {
  return `<?php
// Minimal router for PHP built-in server — simulates WordPress environment
// Auto-stubs ANY undefined WordPress function so the theme can render without WP core

error_reporting(E_ALL & ~E_NOTICE & ~E_WARNING & ~E_DEPRECATED);
define('ABSPATH', __DIR__ . '/');
define('WPINC', 'wp-includes');
define('TEMPLATEPATH', __DIR__);
define('STYLESHEETPATH', __DIR__);
define('WP_CONTENT_DIR', __DIR__);
define('WP_CONTENT_URL', 'http://localhost:${port}');
define('DOING_AJAX', false);

// ── Core stubs that must return specific values ──────────────────
function get_template_directory() { return __DIR__; }
function get_template_directory_uri() { return 'http://localhost:' . (\$_SERVER['SERVER_PORT'] ?? '${port}'); }
function get_stylesheet_directory() { return __DIR__; }
function get_stylesheet_directory_uri() { return get_template_directory_uri(); }
function get_stylesheet_uri() { return get_template_directory_uri() . '/style.css'; }
function language_attributes() { echo 'lang="en"'; }
function body_class(\$class = '') { echo 'class="home front-page ' . (is_string(\$class) ? \$class : implode(' ', (array)\$class)) . '"'; }
function post_class(\$class = '') { echo 'class="post ' . (is_string(\$class) ? \$class : implode(' ', (array)\$class)) . '"'; }
function bloginfo(\$show) {
    \$data = ['charset'=>'UTF-8','name'=>'Theme Preview','description'=>'','url'=>get_template_directory_uri(),'stylesheet_url'=>get_stylesheet_uri(),'template_url'=>get_template_directory_uri(),'version'=>'1.0','html_type'=>'text/html','language'=>'en-US','text_direction'=>'ltr'];
    echo \$data[\$show] ?? '';
}
function get_bloginfo(\$show) { \$data = ['charset'=>'UTF-8','name'=>'Theme Preview','description'=>'','url'=>get_template_directory_uri(),'version'=>'1.0']; return \$data[\$show] ?? ''; }
function wp_head() { echo '<link rel="stylesheet" href="' . get_stylesheet_uri() . '">' . "\\n"; }
function wp_footer() { echo '<!-- wp_footer -->'; }
function wp_body_open() { echo '<!-- wp_body_open -->'; }
function home_url(\$path = '/') { return 'http://localhost:' . (\$_SERVER['SERVER_PORT'] ?? '${port}') . \$path; }
function site_url(\$path = '/') { return home_url(\$path); }
function admin_url(\$path = '') { return home_url('/wp-admin/' . \$path); }
function content_url(\$path = '') { return home_url('/wp-content/' . \$path); }
function includes_url(\$path = '') { return home_url('/wp-includes/' . \$path); }

// ── Escaping & sanitization ─────────────────────────────────────
function esc_html(\$text) { return htmlspecialchars((string)\$text, ENT_QUOTES, 'UTF-8'); }
function esc_attr(\$text) { return htmlspecialchars((string)\$text, ENT_QUOTES, 'UTF-8'); }
function esc_url(\$url) { return filter_var(\$url, FILTER_SANITIZE_URL) ?: ''; }
function esc_textarea(\$text) { return htmlspecialchars((string)\$text, ENT_QUOTES, 'UTF-8'); }
function esc_js(\$text) { return addslashes((string)\$text); }
function esc_html__(\$text, \$d = '') { return esc_html(\$text); }
function esc_html_e(\$text, \$d = '') { echo esc_html(\$text); }
function esc_attr__(\$text, \$d = '') { return esc_attr(\$text); }
function esc_attr_e(\$text, \$d = '') { echo esc_attr(\$text); }
function __(\$text, \$d = '') { return \$text; }
function _e(\$text, \$d = '') { echo \$text; }
function _x(\$text, \$c, \$d = '') { return \$text; }
function _ex(\$text, \$c, \$d = '') { echo \$text; }
function _n(\$s, \$p, \$n, \$d = '') { return \$n === 1 ? \$s : \$p; }
function _nx(\$s, \$p, \$n, \$c, \$d = '') { return \$n === 1 ? \$s : \$p; }
function wp_kses_post(\$text) { return \$text; }
function wp_kses(\$text, \$a = []) { return \$text; }
function sanitize_text_field(\$str) { return trim(strip_tags((string)\$str)); }
function sanitize_email(\$email) { return filter_var(\$email, FILTER_SANITIZE_EMAIL); }
function sanitize_title(\$title) { return strtolower(preg_replace('/[^a-z0-9-]/', '-', strtolower(\$title))); }
function sanitize_html_class(\$class) { return preg_replace('/[^a-zA-Z0-9_-]/', '', \$class); }
function absint(\$val) { return abs((int)\$val); }
function is_email(\$email) { return filter_var(\$email, FILTER_VALIDATE_EMAIL) !== false; }

// ── Theme & options ─────────────────────────────────────────────
function get_theme_mod(\$name, \$default = '') { return \$default; }
function set_theme_mod(\$name, \$value) {}
function get_option(\$name, \$default = false) { return \$default; }
function update_option(\$name, \$value) { return true; }
function wp_get_theme() { return new class { public function get(\$key) { return ''; } public function __toString() { return 'Theme Preview'; } }; }

// ── Hooks (no-ops for preview) ──────────────────────────────────
function add_action() {}
function remove_action() {}
function do_action() {}
function add_filter() { return true; }
function remove_filter() {}
function apply_filters() { \$args = func_get_args(); return \$args[1] ?? ''; }
function has_action() { return false; }
function has_filter() { return false; }

// ── Assets ──────────────────────────────────────────────────────
function wp_enqueue_style() {}
function wp_enqueue_script() {}
function wp_dequeue_style() {}
function wp_dequeue_script() {}
function wp_register_style() {}
function wp_register_script() {}
function wp_localize_script() {}
function wp_add_inline_style() {}
function wp_add_inline_script() {}
function wp_style_is() { return false; }
function wp_script_is() { return false; }

// ── Registration (no-ops) ───────────────────────────────────────
function add_theme_support() {}
function register_nav_menus() {}
function register_nav_menu() {}
function register_sidebar() {}
function register_widget() {}
function add_image_size() {}
function add_editor_style() {}
function set_post_thumbnail_size() {}
function add_post_type_support() {}
function register_post_type() {}
function register_taxonomy() {}

// ── Template functions ──────────────────────────────────────────
function get_header(\$name = null) { include __DIR__ . '/header.php'; }
function get_footer(\$name = null) { include __DIR__ . '/footer.php'; }
function get_sidebar(\$name = null) {}
function get_search_form() { echo '<form role="search"><input type="search" placeholder="Search..."></form>'; }
function get_template_part(\$slug, \$name = null, \$args = []) {
    \$file = __DIR__ . '/' . \$slug;
    if (\$name) \$file .= '-' . \$name;
    \$file .= '.php';
    if (file_exists(\$file)) { extract(is_array(\$args) ? \$args : []); include \$file; }
}
function locate_template(\$names) { foreach((array)\$names as \$n) { \$f = __DIR__ . '/' . \$n; if (file_exists(\$f)) return \$f; } return ''; }
function load_template(\$file) { if (file_exists(\$file)) include \$file; }

// ── Navigation ──────────────────────────────────────────────────
function wp_nav_menu(\$args = []) {
    \$items = \$args['fallback_cb'] ?? null;
    if (\$items && is_callable(\$items)) { call_user_func(\$items, \$args); return; }
    echo '<nav class="main-navigation"><ul><li><a href="/">Home</a></li><li><a href="#">About</a></li><li><a href="#">Contact</a></li></ul></nav>';
}
function has_nav_menu(\$location) { return true; }
function wp_page_menu(\$args = []) { wp_nav_menu(\$args); }
function the_custom_logo() { echo ''; }
function has_custom_logo() { return false; }
function get_custom_logo() { return ''; }

// ── Walker classes (stubs so custom walkers compile) ────────────
if (!class_exists('Walker')) {
class Walker {
    public \$tree_type = '';
    public \$db_fields = [];
    public \$max_pages = 1;
    public function walk(\$elements, \$max_depth, ...\$args) { return ''; }
    public function paged_walk(\$elements, \$max_depth, \$page_num, \$per_page, ...\$args) { return ''; }
    public function start_lvl(&\$output, \$depth = 0, \$args = []) {}
    public function end_lvl(&\$output, \$depth = 0, \$args = []) {}
    public function start_el(&\$output, \$element, \$depth = 0, \$args = [], \$id = 0) {}
    public function end_el(&\$output, \$element, \$depth = 0, \$args = []) {}
}
}
if (!class_exists('Walker_Nav_Menu')) {
class Walker_Nav_Menu extends Walker {
    public \$tree_type = ['post_type', 'taxonomy', 'custom'];
    public \$db_fields = ['parent' => 'menu_item_parent', 'id' => 'db_id'];
    public function start_lvl(&\$output, \$depth = 0, \$args = []) {}
    public function end_lvl(&\$output, \$depth = 0, \$args = []) {}
    public function start_el(&\$output, \$element, \$depth = 0, \$args = [], \$id = 0) {}
    public function end_el(&\$output, \$element, \$depth = 0, \$args = []) {}
}
}

// ── Loop & post ─────────────────────────────────────────────────
function have_posts() { return false; }
function the_post() {}
function the_title(\$before = '', \$after = '', \$echo = true) { \$t = \$before . 'Sample Page' . \$after; if (\$echo) echo \$t; return \$t; }
function get_the_title(\$id = 0) { return 'Sample Page'; }
function the_content() { echo '<p>Sample content</p>'; }
function get_the_content() { return '<p>Sample content</p>'; }
function the_excerpt() { echo '<p>Sample excerpt</p>'; }
function get_the_excerpt() { return 'Sample excerpt'; }
function the_ID() { echo '1'; }
function get_the_ID() { return 1; }
function the_permalink() { echo '#'; }
function get_permalink(\$id = 0) { return '#'; }
function the_post_thumbnail(\$size = '') { echo '<img src="https://loremflickr.com/800/600/photo" alt="thumbnail">'; }
function has_post_thumbnail(\$id = 0) { return true; }
function get_the_post_thumbnail_url(\$id = 0, \$size = '') { return 'https://loremflickr.com/800/600/photo'; }
function the_date(\$f = '') { echo date(\$f ?: 'F j, Y'); }
function get_the_date(\$f = '', \$id = 0) { return date(\$f ?: 'F j, Y'); }
function the_author() { echo 'Author'; }
function get_the_author() { return 'Author'; }
function the_category(\$sep = ', ') { echo 'Category'; }
function the_tags(\$before = '', \$sep = ', ', \$after = '') { echo \$before . 'Tag' . \$after; }
function get_post_type() { return 'page'; }
function get_post(\$id = 0) { return null; }
function comments_open() { return false; }
function get_comments_number() { return 0; }

// ── Conditional tags ────────────────────────────────────────────
function is_front_page() { return true; }
function is_home() { return true; }
function is_single() { return false; }
function is_page() { return false; }
function is_archive() { return false; }
function is_search() { return false; }
function is_404() { return false; }
function is_category() { return false; }
function is_tag() { return false; }
function is_author() { return false; }
function is_admin() { return false; }
function is_user_logged_in() { return false; }
function is_customize_preview() { return false; }
function is_active_sidebar(\$id) { return false; }
function current_user_can(\$cap) { return false; }
function is_singular() { return false; }
function is_page_template() { return false; }

// ── Pagination ──────────────────────────────────────────────────
function the_posts_pagination() {}
function paginate_links() { return ''; }
function previous_posts_link() {}
function next_posts_link() {}

// ── Widgets & sidebars ──────────────────────────────────────────
function dynamic_sidebar(\$id) { return false; }

// ── Security / nonce ────────────────────────────────────────────
function wp_nonce_field(\$a = '', \$n = '_wpnonce') { echo '<input type="hidden" name="' . \$n . '" value="stub">'; }
function wp_create_nonce(\$a = '') { return 'stub_nonce'; }
function wp_verify_nonce(\$n, \$a = '') { return 1; }
function check_ajax_referer(\$a = '', \$q = false) { return true; }

// ── AJAX / JSON ─────────────────────────────────────────────────
function wp_send_json_success(\$data = null) { header('Content-Type: application/json'); echo json_encode(['success'=>true,'data'=>\$data]); exit; }
function wp_send_json_error(\$data = null) { header('Content-Type: application/json'); echo json_encode(['success'=>false,'data'=>\$data]); exit; }
function wp_die(\$msg = '') { echo \$msg; exit; }

// ── Misc ────────────────────────────────────────────────────────
function number_format_i18n(\$number, \$decimals = 0) { return number_format((float)\$number, \$decimals); }
function wp_parse_args(\$args, \$defaults = []) { return array_merge(\$defaults, (array)\$args); }
function wp_list_pluck(\$list, \$field) { return array_column(\$list, \$field); }
function wp_trim_words(\$text, \$num = 55, \$more = '...') { \$words = explode(' ', \$text); return implode(' ', array_slice(\$words, 0, \$num)) . (count(\$words) > \$num ? \$more : ''); }
function trailingslashit(\$str) { return rtrim(\$str, '/') . '/'; }
function untrailingslashit(\$str) { return rtrim(\$str, '/'); }
function get_theme_file_uri(\$file = '') { return get_template_directory_uri() . '/' . ltrim(\$file, '/'); }
function get_theme_file_path(\$file = '') { return get_template_directory() . '/' . ltrim(\$file, '/'); }
function wp_get_attachment_image_url(\$id = 0, \$size = '') { return 'https://loremflickr.com/800/600/photo'; }
function wp_get_attachment_image(\$id = 0, \$size = '') { return '<img src="https://loremflickr.com/800/600/photo" alt="">'; }
function checked(\$v1, \$v2 = true, \$echo = true) { \$r = \$v1 == \$v2 ? ' checked="checked"' : ''; if (\$echo) echo \$r; return \$r; }
function selected(\$v1, \$v2 = true, \$echo = true) { \$r = \$v1 == \$v2 ? ' selected="selected"' : ''; if (\$echo) echo \$r; return \$r; }

// ── Catch-all: auto-stub ANY remaining undefined WP function ────
// Uses a custom error handler so we never get "Call to undefined function"
set_error_handler(function(\$errno, \$errstr, \$errfile, \$errline) {
    // Let PHP handle non-function errors normally
    if (strpos(\$errstr, 'Call to undefined function') === false) {
        return false;
    }
    // Extract function name and create a no-op stub
    if (preg_match('/Call to undefined function ([\\\\w]+)\\\\(/', \$errstr, \$m)) {
        eval('function ' . \$m[1] . '() { return null; }');
    }
    return true;
});

// Alternative: use a shutdown function to catch fatal "undefined function" errors
// and report them clearly
register_shutdown_function(function() {
    \$error = error_get_last();
    if (\$error && \$error['type'] === E_ERROR && strpos(\$error['message'], 'Call to undefined function') !== false) {
        // Extract function name for debugging
        preg_match('/Call to undefined function (\\S+)/', \$error['message'], \$m);
        \$fn = \$m[1] ?? 'unknown';
        echo "<div style='background:#fee;border:2px solid #c00;padding:16px;margin:16px;font-family:monospace'>";
        echo "<b>Missing WordPress function:</b> " . htmlspecialchars(\$fn) . "<br>";
        echo "<b>File:</b> " . htmlspecialchars(\$error['file']) . " line " . \$error['line'];
        echo "</div>";
    }
});

// ── Load theme (functions.php will require inc/ files itself) ───
if (file_exists(__DIR__ . '/functions.php')) { require_once __DIR__ . '/functions.php'; }

// ── Serve static files ─────────────────────────────────────────
\$uri = urldecode(parse_url(\$_SERVER['REQUEST_URI'], PHP_URL_PATH));
if (\$uri !== '/' && file_exists(__DIR__ . \$uri)) {
    \$ext = pathinfo(\$uri, PATHINFO_EXTENSION);
    \$types = ['css'=>'text/css','js'=>'application/javascript','png'=>'image/png','jpg'=>'image/jpeg','gif'=>'image/gif','svg'=>'image/svg+xml','ico'=>'image/x-icon','woff'=>'font/woff','woff2'=>'font/woff2'];
    if (isset(\$types[\$ext])) { header('Content-Type: ' . \$types[\$ext]); }
    readfile(__DIR__ . \$uri);
    return;
}

// ── Serve front page ────────────────────────────────────────────
if (file_exists(__DIR__ . '/front-page.php')) {
    include __DIR__ . '/front-page.php';
} else {
    include __DIR__ . '/index.php';
}
`;
}

/** Write .router.php to a project directory */
async function ensureRouterFile(projectDir: string, port: number): Promise<void> {
  const routerPath = path.join(projectDir, ".router.php");
  await fs.writeFile(routerPath, generateRouterContent(port), "utf-8");
}

/** Fetch a URL and return { status, body } */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => { req.destroy(new Error("HTTP request timeout")); });
  });
}

/**
 * Start a PHP built-in server, fetch index, capture PHP errors.
 * Returns errors found in server output or HTTP 500 responses.
 * Note: Without a real WordPress installation, this is a basic PHP syntax/runtime check.
 */
async function runtimeCheck(projectDir: string): Promise<RuntimeCheckResult> {
  const PORT = 3457;
  const errors: string[] = [];
  let serverOutput = "";
  let serverReady = false;

  // Create router script for PHP built-in server
  await ensureRouterFile(projectDir, PORT);

  const proc = spawn("php", ["-S", `localhost:${PORT}`, ".router.php"], {
    cwd: projectDir,
    stdio: "pipe",
    env: { ...process.env },
  });

  proc.stdout?.on("data", (d: Buffer) => { serverOutput += d.toString(); });
  proc.stderr?.on("data", (d: Buffer) => { serverOutput += d.toString(); });

  // Wait for server to be ready (max 10s — PHP starts fast)
  const startTime = Date.now();
  while (Date.now() - startTime < 10_000) {
    if (serverOutput.includes("started") || serverOutput.includes("Development Server") || serverOutput.includes("listening")) {
      serverReady = true;
      break;
    }
    await sleep(500);
  }

  if (!serverReady) {
    proc.kill("SIGTERM");
    // Clean up router file
    try { await fs.unlink(path.join(projectDir, ".router.php")); } catch {}
    return { success: false, errors: ["PHP dev server failed to start within 10s"], serverOutput };
  }

  await sleep(1000);

  const pagesToTest = ["/"];
  log("INFO", `Runtime check: testing ${pagesToTest.length} page(s): ${pagesToTest.join(", ")}`);

  for (const pagePath of pagesToTest) {
    try {
      const outputBefore = serverOutput.length;
      const res = await httpGet(`http://localhost:${PORT}${pagePath}`);
      await sleep(1500);
      const newOutput = serverOutput.slice(outputBefore);

      if (res.status === 500) {
        const typeErrorMatch = newOutput.match(/(TypeError|ReferenceError|SyntaxError):\s+(.+?)(?:\n|$)/);
        const fileMatch = newOutput.match(/(src\/[^\s]+)\s+\((\d+):(\d+)\)/);

        let errorDetail = `Page "${pagePath}" returned HTTP 500.`;
        if (typeErrorMatch) errorDetail += ` ${typeErrorMatch[1]}: ${typeErrorMatch[2]}`;
        if (fileMatch) errorDetail += ` at ${fileMatch[1]}:${fileMatch[2]}:${fileMatch[3]}`;
        if (newOutput) errorDetail += `\n\nServer output:\n${newOutput.slice(0, 3000)}`;

        errors.push(errorDetail);
        log("WARN", `Runtime error on ${pagePath}: HTTP 500`);
      } else if (res.status >= 400 && res.status !== 404) {
        errors.push(`Page "${pagePath}" returned HTTP ${res.status}`);
      } else {
        log("INFO", `Runtime check: ${pagePath} → HTTP ${res.status} ✓`);
      }
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      errors.push(`Failed to fetch "${pagePath}": ${msg}`);
    }
  }

  // Scan full server output for PHP errors
  const runtimePatterns = [
    /PHP\s+(?:Fatal|Parse|Warning|Notice)\s+error:\s+([^\n]+)/gi,
    /Uncaught\s+Error:\s+([^\n]+)/gi,
    /undefined function\s+([^\n]+)/gi,
    /Stack trace:/g,
  ];

  for (const pat of runtimePatterns) {
    let m;
    while ((m = pat.exec(serverOutput)) !== null) {
      const errText = m[0].trim();
      if (!errors.some((e) => e.includes(errText.slice(0, 50)))) {
        errors.push(`Server log: ${errText}`);
      }
    }
  }

  proc.kill("SIGTERM");
  // Clean up router file
  try { await fs.unlink(path.join(projectDir, ".router.php")); } catch {}
  return { success: errors.length === 0, errors, serverOutput };
}

// ═════════════════════════════════════════════════════════════════════════════
//  AGENT 4 — BUILD & AUTO-FIX (retry loop, max 5 attempts)
// ═════════════════════════════════════════════════════════════════════════════

async function buildAndFixAgent(ctx: SharedContext): Promise<AgentResult<string>> {
  const MAX_RETRIES = 5;
  const ws = ctx.workspacePath;

  // Step 1: Validate PHP syntax for all PHP files
  log("INFO", "Validating PHP syntax…");

  const RUNTIME_MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log("INFO", `PHP lint attempt ${attempt}/${MAX_RETRIES}…`);

    // Collect all PHP files
    const allFiles = await listFilesSafe(ws);
    const phpFiles = allFiles.filter((f) => f.endsWith(".php"));
    let allValid = true;
    let lintOutput = "";

    for (const phpFile of phpFiles) {
      const result = execSafe(`php -l "${phpFile}"`, ws);
      lintOutput += `${phpFile}: ${result.stdout}\n`;
      if (!result.success) {
        allValid = false;
        log("WARN", `PHP syntax error in ${phpFile}: ${result.stdout}`);
      }
    }

    ctx.buildLogs.push(lintOutput);

    if (allValid) {
      log("INFO", "All PHP files pass syntax check ✓");

      // Step 2: runtime check — start PHP dev server and fetch pages
      let runtimeOk = false;
      for (let rtAttempt = 1; rtAttempt <= RUNTIME_MAX_RETRIES; rtAttempt++) {
        log("INFO", `Runtime check attempt ${rtAttempt}/${RUNTIME_MAX_RETRIES}…`);
        const rt = await runtimeCheck(ws);

        if (rt.success) {
          log("INFO", "Runtime check passed — pages render without PHP errors");
          runtimeOk = true;
          break;
        }

        log("WARN", `Runtime errors found (attempt ${rtAttempt}):`, { errors: rt.errors.slice(0, 3) });

        if (rtAttempt === RUNTIME_MAX_RETRIES) {
          log("WARN", `Runtime check failed after ${RUNTIME_MAX_RETRIES} attempts — proceeding anyway`);
          break;
        }

        // Send runtime errors to LLM for fix
        log("INFO", "Requesting runtime fix from LLM…");

        const errorFileMatches = rt.errors.join("\n").match(/[^\s:]+\.php/g) ?? [];
        const errorFiles = [...new Set(errorFileMatches)];

        const sourceFiles: { path: string; content: string }[] = [];
        const added = new Set<string>();

        // Add files directly mentioned in errors + always include functions.php + theme-data.php
        const alwaysInclude = ["functions.php", "inc/theme-data.php"];
        for (const fp of allFiles) {
          if (!fp.endsWith(".php") && !fp.endsWith(".css") && !fp.endsWith(".js")) continue;
          const isErrorFile = errorFiles.some((ef) => fp.includes(path.basename(ef)) || ef.includes(path.basename(fp)));
          const isAlways = alwaysInclude.some((a) => fp.endsWith(a));

          if ((isErrorFile || isAlways) && !added.has(fp)) {
            added.add(fp);
            sourceFiles.push({ path: fp, content: await readFileSafe(ws, fp) });
          }
        }

        const rtFixPrompt = `[FIX_RUNTIME_ERROR]
The WordPress theme has PHP errors when pages are loaded.

Runtime errors:
${rt.errors.map((e, i) => `${i + 1}. ${e}`).join("\n\n")}

Relevant source files:
${JSON.stringify(sourceFiles, null, 2)}

Common causes:
- Calling undefined functions (missing require_once or wrong function name)
- Accessing undefined array keys
- Missing ABSPATH check at top of files
- Wrong function signatures or missing parameters
- Missing closing PHP tags or syntax errors
- Plugin-dependent code: WooCommerce functions such as WC(), wc_get_cart_url(), WC()->cart may be unavailable or null in local preview.
- Fix by removing WooCommerce dependency unless explicitly requested, or guard all WooCommerce calls.

RULES:
- Fix the root cause, don't just suppress errors
- Ensure all template parts are properly included via get_template_part()
- Ensure all data functions are defined in inc/theme-data.php and loaded via functions.php
- Use proper WordPress escaping
- Check that inc/customizer.php and inc/theme-data.php are require_once'd in functions.php

Respond with JSON:
{
  "fixes": [
    { "filePath": "path/to/file.php", "content": "complete corrected content" }
  ],
  "explanation": "What was wrong and how it was fixed"
}`;

        const rtFix = (await callLLM(rtFixPrompt)) as BuildFixResponse;
        log("INFO", `Runtime fix: ${rtFix.explanation}`);

        for (const f of rtFix.fixes) {
          await writeFileSafe(ws, f.filePath, f.content);
        }

        if (rtAttempt < RUNTIME_MAX_RETRIES) {
          log("INFO", "Waiting 10s before next runtime check…");
          await sleep(10_000);
        }
      }

      return { success: true, data: lintOutput };
    }

    log("WARN", `PHP lint failed (attempt ${attempt})`, { output: lintOutput.slice(0, 500) });

    if (attempt === MAX_RETRIES) {
      return {
        success: false,
        data: "",
        error: `PHP lint failed after ${MAX_RETRIES} attempts:\n${lintOutput}`,
      };
    }

    // Ask LLM to fix PHP errors
    log("INFO", "Requesting PHP fix from LLM…");

    const sourceFiles: { path: string; content: string }[] = [];

    for (const fp of allFiles) {
      if (fp.endsWith(".php") || fp.endsWith(".css") || fp.endsWith(".js")) {
        sourceFiles.push({ path: fp, content: await readFileSafe(ws, fp) });
      }
    }

    const fixPrompt = `[FIX_BUILD]
The following WordPress theme has PHP syntax errors. Analyze and provide fixed file contents.

PHP lint output:
${lintOutput}

Project files:
${JSON.stringify(sourceFiles, null, 2)}

Respond with JSON:
{
  "fixes": [
    { "filePath": "path/to/file.php", "content": "complete corrected content" }
  ],
  "explanation": "What was wrong and how it was fixed"
}`;

    const fix = (await callLLM(fixPrompt)) as BuildFixResponse;
    log("INFO", `LLM fix: ${fix.explanation}`);

    for (const f of fix.fixes) {
      await writeFileSafe(ws, f.filePath, f.content);
    }

    if (attempt < MAX_RETRIES) {
      log("INFO", "Waiting 15s before next lint attempt (rate limit cooldown)…");
      await sleep(15_000);
    }
  }

  return { success: false, data: "", error: "Build loop exited unexpectedly" };
}

// ═════════════════════════════════════════════════════════════════════════════
//  AGENT 5 — TEST RUNNER
// ═════════════════════════════════════════════════════════════════════════════

async function testRunner(ctx: SharedContext): Promise<AgentResult<string>> {
  try {
    log("INFO", "Running PHP lint validation…");
    // Find all PHP files and lint them
    const findResult = execSafe(`find . -name "*.php" ! -name ".router.php"`, ctx.workspacePath);
    const phpFiles = findResult.success ? findResult.stdout.trim().split("\n").filter(Boolean) : [];

    const errors: string[] = [];
    const passed: string[] = [];
    for (const f of phpFiles) {
      const r = execSafe(`php -l "${f}"`, ctx.workspacePath);
      if (r.success) {
        passed.push(f);
      } else {
        errors.push(`${f}: ${r.stdout}`);
      }
    }

    const summary = `PHP Lint Results:\n  Passed: ${passed.length} files\n  Failed: ${errors.length} files\n${errors.length > 0 ? "\nErrors:\n" + errors.join("\n") : ""}`;
    ctx.testLogs.push(summary);

    if (errors.length === 0) {
      log("INFO", `All ${passed.length} PHP files passed lint`);
      return { success: true, data: summary };
    }

    log("WARN", `${errors.length} PHP files have syntax errors`);
    return { success: false, data: summary, error: `PHP lint failed:\n${errors.join("\n")}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: "", error: msg };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  AGENT 6 — GIT COMMIT
// ═════════════════════════════════════════════════════════════════════════════

async function gitCommitAgent(ctx: SharedContext): Promise<AgentResult<string>> {
  try {
    const ws = ctx.workspacePath;

    const prompt = `[COMMIT_MSG]
Generate a conventional commit message for this project.

Project: ${ctx.analysis?.projectName}
Summary: ${ctx.analysis?.summary}
Files: ${ctx.generatedFiles.map((f) => f.filePath).join(", ")}

Respond with JSON:
{ "message": "feat: descriptive commit message" }`;

    const { message } = (await callLLM(prompt)) as CommitMessageResponse;

    log("INFO", "Initializing git repo…");
    gitInit(ws);

    // Create .gitignore
    await writeFileSafe(
      ws,
      ".gitignore",
      ["node_modules/", "dist/", ".DS_Store", "*.log", ""].join("\n")
    );

    gitAdd(ws);
    const commit = gitCommit(ws, message);

    if (!commit.success) {
      return { success: false, data: "", error: `git commit failed:\n${commit.stdout}` };
    }

    log("INFO", `Committed: ${message}`);
    return { success: true, data: `Committed with message: ${message}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: "", error: msg };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  USER INTERACTION
// ═════════════════════════════════════════════════════════════════════════════

function displayResult(name: string, result: AgentResult): void {
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log(`  Agent: ${name}`);
  console.log(`  Status: ${result.success ? "✓ SUCCESS" : "✗ FAILED"}`);

  if (result.error) {
    console.log(`  Error: ${result.error.split("\n")[0]}`);
  }

  const data = result.data as Record<string, unknown>;
  if (data && typeof data === "object") {
    if ("projectName" in data) {
      const a = data as unknown as FeatureAnalysis;
      console.log(`  Project: ${a.projectName}`);
      console.log(`  Features: ${a.features.length}`);
      console.log(`  Stack: ${[...a.techStack.frontend, ...a.techStack.backend].join(", ")}`);
    } else if ("architecture" in data) {
      const s = data as unknown as ProjectSpec;
      console.log(`  Architecture: ${s.architecture}`);
      console.log(`  Files planned: ${s.fileStructure.length}`);
    }
  }

  if (Array.isArray(result.data)) {
    const files = result.data as GeneratedFile[];
    if (files.length > 0 && "filePath" in files[0]) {
      console.log(`  Files generated: ${files.length}`);
      files.forEach((f) => console.log(`    • ${f.filePath}`));
    }
  }

  if (typeof result.data === "string" && result.data.length > 0) {
    const preview = result.data.split("\n").slice(0, 5).join("\n");
    console.log(`  Output:\n${preview}`);
  }

  console.log(divider);
}

// ═════════════════════════════════════════════════════════════════════════════
//  REVIEW OUTPUTS — Markdown reports for each agent
// ═════════════════════════════════════════════════════════════════════════════

async function generateIdeaMd(ctx: SharedContext): Promise<string> {
  const a = ctx.analysis!;
  const mdPath = path.join(ctx.workspacePath, "IDEA.md");

  const priorityEmoji = (p: string) =>
    p === "high" ? "🔴" : p === "medium" ? "🟡" : "🟢";

  const lines = [
    `# ${a.projectName}`,
    "",
    `> ${a.summary}`,
    "",
    "---",
    "",
    "## 🎯 Project Overview",
    "",
    `**Target Audience:** ${a.targetAudience}`,
    "",
    "**Goals:**",
    "",
    ...(a.goals ?? []).map((g) => `- ${g}`),
    "",
    "---",
    "",
    "## 👤 User Stories",
    "",
    "| # | Role | Goal | Rationale |",
    "|---|------|------|-----------|",
    ...(a.userStories ?? []).map(
      (s, i) => `| ${i + 1} | **${s.role}** | ${s.goal} | ${s.rationale} |`
    ),
    "",
    "---",
    "",
    "## ✅ Functional Requirements",
    "",
    "| # | Feature | Description | Priority | Acceptance Criteria |",
    "|---|---------|-------------|----------|---------------------|",
    ...a.features.map(
      (f, i) =>
        `| ${i + 1} | **${f.name}** | ${f.description} | ${priorityEmoji(f.priority)} ${f.priority} | ${(f.acceptanceCriteria ?? []).map((c) => `• ${c}`).join("<br>")} |`
    ),
    "",
    "---",
    "",
    "## 🎨 Design Direction",
    "",
    ...(a.designDirection
      ? [
          `- **Tone:** ${a.designDirection.tone}`,
          `- **Color Palette:** ${a.designDirection.colorPalette}`,
          `- **Typography:** ${a.designDirection.typography}`,
          `- **Inspiration:** ${(a.designDirection.inspiration ?? []).join(", ")}`,
        ]
      : []),
    "",
    "---",
    "",
    "## ⚙️ Non-Functional Requirements",
    "",
    "### Performance",
    "",
    ...(a.nonFunctionalRequirements?.performance ?? []).map((r) => `- ${r}`),
    "",
    "### Accessibility",
    "",
    ...(a.nonFunctionalRequirements?.accessibility ?? []).map((r) => `- ${r}`),
    "",
    "### SEO",
    "",
    ...(a.nonFunctionalRequirements?.seo ?? []).map((r) => `- ${r}`),
    "",
    "---",
    "",
    "## 📝 Content Requirements",
    "",
    ...(a.contentRequirements ?? []).map((c) => `- ${c}`),
    "",
    "---",
    "",
    "## 🛠 Tech Stack",
    "",
    `- **Frontend:** ${a.techStack.frontend.join(", ")}`,
    `- **Backend:** ${a.techStack.backend.length > 0 ? a.techStack.backend.join(", ") : "N/A (static site)"}`,
    `- **Dev Tools:** ${a.techStack.devtools.join(", ")}`,
    "",
    "---",
    `*Generated by AI Coding Agent — ${new Date().toISOString()}*`,
    "",
  ];

  const content = lines.join("\n");
  await fs.mkdir(ctx.workspacePath, { recursive: true });
  await writeFileSafe(ctx.workspacePath, "IDEA.md", content);
  log("INFO", `Wrote IDEA.md to ${mdPath}`);

  // Print to console for review
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│  📄 IDEA.md — Review the analysis below                │");
  console.log("└─────────────────────────────────────────────────────────┘");
  console.log(content);

  return mdPath;
}

async function generateSpecMd(ctx: SharedContext): Promise<string> {
  const s = ctx.spec!;
  const a = ctx.analysis!;
  const mdPath = path.join(ctx.workspacePath, "SPEC.md");

  // Build file tree from fileStructure
  const buildTree = (files: FileSpec[]): string => {
    const sorted = [...files].sort((a, b) => a.filePath.localeCompare(b.filePath));
    const lines: string[] = [];
    const seen = new Set<string>();

    for (const f of sorted) {
      const parts = f.filePath.split("/");
      let prefix = "";
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts.slice(0, i + 1).join("/");
        if (!seen.has(dir)) {
          seen.add(dir);
          lines.push(`${"  ".repeat(i)}📁 ${parts[i]}/`);
        }
      }
      prefix = "  ".repeat(parts.length - 1);
      const ext = path.extname(parts[parts.length - 1]);
      const icon =
        ext === ".php"
          ? "📄"
          : ext === ".css"
            ? "🎨"
            : ext === ".js"
              ? "⚡"
              : ext === ".json"
                ? "⚙️"
                : "📄";
      lines.push(`${prefix}${icon} ${parts[parts.length - 1]}  — ${f.description}`);
    }
    return lines.join("\n");
  };

  // Build component diagram (ASCII)
  const templateParts = s.fileStructure
    .filter((f) => f.filePath.includes("template-parts/"))
    .map((f) => path.basename(f.filePath, path.extname(f.filePath)));

  const diagram = [
    "```",
    "┌─────────────────────────────────────────────┐",
    "│              WordPress Theme                │",
    "│  header.php ──→ front-page.php ──→ footer   │",
    "│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │",
    ...templateParts.map(
      (name) => `│  │ ${name.padEnd(8).slice(0, 8)} │                              │`
    ),
    "│  └──────────┘ └──────────┘ └──────────┘     │",
    "│                                             │",
    "│  inc/ ──→ template-parts/ ──→ Page Templates│",
    "│  functions.php ──→ Enqueue + Setup           │",
    "└─────────────────────────────────────────────┘",
    "```",
  ];

  const lines = [
    `# Project Specification: ${a.projectName}`,
    "",
    `## Architecture`,
    "",
    s.architecture,
    "",
    "## Component Overview",
    "",
    ...diagram,
    "",
    "## File Structure",
    "",
    "```",
    buildTree(s.fileStructure),
    "```",
    "",
    "## Build & Test",
    "",
    `- **Build:** \`${s.buildScript}\``,
    `- **Test:** \`${s.testScript}\``,
    "",
    s.apiEndpoints.length > 0
      ? [
          "## API Endpoints",
          "",
          "| Method | Path | Description |",
          "|--------|------|-------------|",
          ...s.apiEndpoints.map((e) => `| ${e.method} | ${e.path} | ${e.description} |`),
          "",
        ].join("\n")
      : "",
    "---",
    `*Generated by AI Coding Agent — ${new Date().toISOString()}*`,
    "",
  ];

  const content = lines.filter(Boolean).join("\n");
  await writeFileSafe(ctx.workspacePath, "SPEC.md", content);
  log("INFO", `Wrote SPEC.md to ${mdPath}`);

  // Print to console
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│  📐 SPEC.md — Review the specification below           │");
  console.log("└─────────────────────────────────────────────────────────┘");
  console.log(content);

  return mdPath;
}

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTIVE REVIEW — Dev server + change/fix loop
// ═════════════════════════════════════════════════════════════════════════════

let devServerProcess: ChildProcess | null = null;

function startDevServer(projectDir: string): void {
  if (devServerProcess) {
    devServerProcess.kill("SIGTERM");
    devServerProcess = null;
  }

  // Always write .router.php before starting (synchronous write to guarantee it exists)
  const routerPath = path.join(projectDir, ".router.php");
  writeFileSync(routerPath, generateRouterContent(3456), "utf-8");

  log("INFO", "Starting PHP dev server…");
  devServerProcess = spawn("php", ["-S", "localhost:3456", ".router.php"], {
    cwd: projectDir,
    stdio: "pipe",
    env: { ...process.env },
  });

  devServerProcess.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line.includes("started") || line.includes("localhost") || line.includes("Development Server")) {
      log("INFO", `Dev server: ${line}`);
    }
  });
  devServerProcess.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) {
      log("DEBUG", `Dev server stderr: ${line}`);
    }
  });

  log("INFO", "Dev server starting on http://localhost:3456 …");
}

function stopDevServer(): void {
  if (devServerProcess) {
    devServerProcess.kill("SIGTERM");
    devServerProcess = null;
    log("INFO", "Dev server stopped");
  }
}

/**
 * Pre-review validation: fetch the live preview page, capture PHP errors from
 * the dev-server stderr, and auto-fix up to PRE_REVIEW_MAX attempts before
 * presenting the review menu to the user.
 */
async function preReviewValidation(ctx: SharedContext): Promise<void> {
  const PRE_REVIEW_MAX = 3;
  let devOutput = "";

  for (let attempt = 1; attempt <= PRE_REVIEW_MAX; attempt++) {
    log("INFO", `Pre-review validation (attempt ${attempt}/${PRE_REVIEW_MAX})…`);

    // Capture stderr from running dev server
    devOutput = "";
    const captureStderr = (d: Buffer) => { devOutput += d.toString(); };
    devServerProcess?.stderr?.on("data", captureStderr);

    // Fetch the page
    let fetchOk = false;
    let httpStatus = 0;
    try {
      const res = await httpGet("http://localhost:3456/");
      httpStatus = res.status;
      fetchOk = true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log("WARN", `Pre-review fetch failed: ${msg}`);
    }

    // Wait a moment for stderr output to arrive
    await sleep(2000);
    devServerProcess?.stderr?.removeListener("data", captureStderr);

    // Scan stderr for PHP errors
    const phpErrorPatterns = [
      /PHP\s+Fatal\s+error:\s+([^\n]+)/gi,
      /PHP\s+Parse\s+error:\s+([^\n]+)/gi,
      /PHP\s+Warning:\s+([^\n]+)/gi,
      /Uncaught\s+(?:Error|TypeError|ValueError|ArgumentCountError):\s+([^\n]+)/gi,
    ];

    const errors: string[] = [];
    for (const pat of phpErrorPatterns) {
      let m;
      while ((m = pat.exec(devOutput)) !== null) {
        errors.push(m[0].trim());
      }
    }

    if (!fetchOk) {
      errors.push(`HTTP fetch failed (server may have crashed)`);
    } else if (httpStatus === 500) {
      errors.push(`Page returned HTTP 500`);
    }

    if (errors.length === 0) {
      log("INFO", "Pre-review validation passed ✓ — no PHP errors detected");
      return;
    }

    log("WARN", `Pre-review found ${errors.length} error(s):`);
    for (const e of errors) log("WARN", `  • ${e.split("\n")[0]}`);

    if (attempt === PRE_REVIEW_MAX) {
      log("WARN", "Max pre-review fix attempts reached — showing review with known issues");
      console.log("\n  ⚠️  Some PHP errors remain — review the site carefully");
      return;
    }

    // ── Collect source files and send to LLM for fix ───────────
    log("INFO", "Sending errors to LLM for auto-fix…");

    const brokenFiles = new Set<string>();
    for (const err of errors) {
      const matches = err.matchAll(/([^\s:]+\.php)/g);
      for (const m of matches) {
        let rel = m[1];
        // Convert absolute paths to relative
        if (rel.startsWith(ctx.workspacePath)) rel = rel.slice(ctx.workspacePath.length + 1);
        if (rel.startsWith("/")) rel = rel.slice(1);
        brokenFiles.add(rel);
      }
    }

    // Always include functions.php and theme-data.php — needed to resolve undefined function errors
    for (const f of ["functions.php", "inc/theme-data.php"]) {
      if (existsSync(path.join(ctx.workspacePath, f))) brokenFiles.add(f);
    }
    // Only add all template-parts/inc if we have very few broken files (to stay within token budget)
    if (brokenFiles.size <= 2) {
      try {
        for (const f of await fs.readdir(path.join(ctx.workspacePath, "inc"))) {
          if (f.endsWith(".php")) brokenFiles.add(`inc/${f}`);
        }
      } catch { /* no inc dir */ }
      try {
        for (const f of await fs.readdir(path.join(ctx.workspacePath, "template-parts"))) {
          if (f.endsWith(".php")) brokenFiles.add(`template-parts/${f}`);
        }
      } catch { /* no template-parts dir */ }
    }

    const fileContents: string[] = [];
    for (const relPath of brokenFiles) {
      try {
        const content = await fs.readFile(path.join(ctx.workspacePath, relPath), "utf-8");
        fileContents.push(`=== ${relPath} ===\n${content}`);
      } catch { /* skip */ }
    }

    const fixPrompt = `You are fixing PHP RUNTIME errors in a WordPress theme running on PHP's built-in dev server.
The theme uses stub functions (no real WordPress) so some WP functions are no-ops.

ERRORS FROM PHP DEV SERVER:
${errors.join("\n")}

FULL SERVER STDERR:
${devOutput.slice(-3000)}

SOURCE FILES:
${fileContents.join("\n\n")}

COMMON FIXES:
- "Call to undefined function X()" → function not included or misspelled
- "Cannot redeclare function X()" → file loaded twice, use require_once instead of require
- "Argument #1 must be of type int|float, string given" for number_format() → cast with (float) or use intval()
- "Undefined array key" → use isset() or ?? default
- Missing data field → check inc/theme-data.php for correct field names, fix callers to match

Return JSON:
{
  "explanation": "what you fixed and why",
  "files": [
    { "path": "relative/path.php", "content": "...complete corrected file content..." }
  ]
}

RULES:
- Fix ALL errors, not just the first
- Return COMPLETE file contents for each fixed file
- Do NOT remove ABSPATH checks — instead define ABSPATH in the fix if needed
- Ensure data keys in templates match the keys defined in inc/theme-data.php`;

    try {
      const fix = (await callLLM(fixPrompt)) as { explanation?: string; files?: Array<{ path: string; content: string }> };
      if (fix.files && Array.isArray(fix.files)) {
        for (const f of fix.files) {
          const filePath = path.join(ctx.workspacePath, f.path);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, f.content, "utf-8");
          log("INFO", `  Fixed: ${f.path}`);
        }
        log("INFO", `Pre-review fix applied: ${fix.explanation ?? "see files"}`);
      }
    } catch (fixErr: unknown) {
      const msg = fixErr instanceof Error ? fixErr.message : String(fixErr);
      log("ERROR", `LLM pre-review fix failed: ${msg}`);
      break;
    }

    // Restart dev server with fixed files
    stopDevServer();
    startDevServer(ctx.workspacePath);
    await sleep(3000);
  }
}

async function askAgentReview(kind: AgentKind): Promise<ReviewChoice> {
  if (process.env.AUTO_APPROVE === "true") {
    log("INFO", "Auto-approved (AUTO_APPROVE=true)");
    return { action: "approve" };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const hints: Record<AgentKind, string[]> = {
      analysis: [
        '    "add a blog section to the features"',
        '    "add a custom post type for portfolio items"',
        '    "add user authentication as a high priority feature"',
      ],
      spec: [
        '    "add a FAQ component to the file structure"',
        '    "add a data file for testimonials"',
        '    "remove the contact form, add a chatbot instead"',
      ],
      codegen: [
        '    "change the hero background color to dark blue"',
        '    "make the header sticky with blur effect"',
        '    "change all text content to English"',
      ],
      build: [
        '    "fix the product cards — images are too small"',
        '    "add more spacing between sections"',
        '    "change the font size of headings"',
      ],
      test: [
        '    "add a test for the contact form validation"',
        '    "skip the failing test for now"',
      ],
      commit: [
        '    "change the commit message to be more descriptive"',
      ],
    };

    const hasDevServer = kind === "build" || kind === "codegen";

    console.log("\n┌─────────────────────────────────────────────────────────┐");
    if (hasDevServer) {
      console.log("│  🔍 Review your project at http://localhost:3456       │");
      console.log("├─────────────────────────────────────────────────────────┤");
    }
    console.log("│  [a] ✅ Approve — continue to next step               │");
    console.log("│  [c] ✏️  Change — request modifications                │");
    console.log("│  [r] 🔄 Regenerate — re-run this agent from scratch   │");
    console.log("│  [q] ❌ Quit — stop the pipeline                      │");
    console.log("└─────────────────────────────────────────────────────────┘");

    const choice = await rl.question("\n❯ Your choice (a/c/r/q): ");
    const action = choice.trim().toLowerCase();

    if (action === "c") {
      console.log("\n  Describe what you want to change. Examples:");
      (hints[kind] ?? []).forEach((h) => console.log(h));
      const feedback = await rl.question("\n❯ Describe changes: ");
      return { action: "change", feedback: feedback.trim() };
    }
    if (action === "r") return { action: "regenerate" };
    if (action === "q") return { action: "quit" };
    return { action: "approve" };
  } finally {
    rl.close();
  }
}

// ── Agent-specific change appliers ──────────────────────────────────────────

async function applyAnalysisChange(ctx: SharedContext, feedback: string): Promise<void> {
  log("INFO", `Refining analysis: "${feedback}"`);
  const prompt = `[REFINE_ANALYSIS]
The user reviewed the idea analysis and wants changes.

Current analysis:
${JSON.stringify(ctx.analysis, null, 2)}

User request: "${feedback}"
Original idea: "${ctx.idea}"

Respond with the COMPLETE updated JSON (same schema as before):
{
  "projectName": "...",
  "summary": "...",
  "features": [{ "name": "...", "description": "...", "priority": "high|medium|low" }],
  "techStack": { "frontend": [...], "backend": [...], "devtools": [...] }
}

Apply the user's requested changes while keeping all other fields intact.`;

  const result = (await callLLM(prompt)) as FeatureAnalysis;
  ctx.analysis = result;
  log("INFO", `Analysis updated: ${result.features.length} features`);
  await generateIdeaMd(ctx);
}

async function applySpecChange(ctx: SharedContext, feedback: string): Promise<void> {
  log("INFO", `Refining spec: "${feedback}"`);
  const prompt = `[REFINE_SPEC]
The user reviewed the project spec and wants changes.

Current spec:
${JSON.stringify(ctx.spec, null, 2)}

Analysis:
${JSON.stringify(ctx.analysis, null, 2)}

User request: "${feedback}"

Respond with the COMPLETE updated JSON (same schema as before):
{
  "architecture": "...",
  "fileStructure": [{ "filePath": "...", "description": "..." }],
  "apiEndpoints": [],
  "buildScript": "php -l *.php inc/*.php template-parts/*.php",
  "testScript": "php -l *.php"
}

Apply the user's requested changes while keeping all other fields intact.
Remember: WordPress theme with style.css, functions.php, header.php, footer.php, template-parts/, inc/, assets/ structure.`;

  const result = (await callLLM(prompt)) as ProjectSpec;
  ctx.spec = result;
  log("INFO", `Spec updated: ${result.fileStructure.length} files planned`);
  await generateSpecMd(ctx);
}

async function applyCodeChange(ctx: SharedContext, feedback: string): Promise<void> {
  log("INFO", `Applying code change: "${feedback}"`);

  const allFiles = await listFilesSafe(ctx.workspacePath);
  const sourceFiles: { path: string; content: string }[] = [];

  for (const fp of allFiles) {
    if (fp.startsWith("node_modules") || fp.startsWith(".next") || fp.startsWith(".git")) continue;
    if (fp.endsWith(".md") || fp === ".router.php") continue;
    if (/\.(php|css|js|json)$/.test(fp)) {
      const content = await readFileSafe(ctx.workspacePath, fp);
      sourceFiles.push({ path: fp, content });
    }
  }

  const prompt = `[APPLY_CHANGE]
The user is reviewing their WordPress theme and wants changes made.

User request: "${feedback}"

Project: ${ctx.analysis?.projectName}
Idea: "${ctx.idea}"

Current source files:
${sourceFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}

Respond with JSON:
{
  "fixes": [
    { "filePath": "path/to/file", "content": "complete updated file content" }
  ],
  "explanation": "What was changed and why"
}

RULES:
- Only include files that need to change — don't regenerate unchanged files
- Return the COMPLETE file content (not a diff/patch)
- This is a WordPress PHP theme — use proper escaping (esc_html, esc_attr, esc_url)
- Use i18n functions (__(), _e(), esc_html_e()) for translatable strings
- If the user asks about style changes, modify the CSS in style.css or the relevant template-part
- If the user asks about content changes, modify inc/theme-data.php or the template-part text
- Keep the existing CSS custom properties and BEM class naming
- Do NOT break existing PHP includes or function calls
- Do NOT introduce React, JSX, TypeScript, or Tailwind`;

  const fix = (await callLLM(prompt, 32000)) as BuildFixResponse;
  log("INFO", `Applied changes: ${fix.explanation}`);

  for (const f of fix.fixes) {
    await writeFileSafe(ctx.workspacePath, f.filePath, f.content);
    log("INFO", `  Updated: ${f.filePath}`);
  }

  console.log(`\n  ✅ Changes applied: ${fix.explanation}`);
  console.log(`  📝 ${fix.fixes.length} file(s) updated`);
  fix.fixes.forEach((f) => console.log(`     • ${f.filePath}`));
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHECKPOINT — save/load progress for resume
// ═════════════════════════════════════════════════════════════════════════════

async function saveCheckpoint(ctx: SharedContext, agentIndex: number, completedAgents: number[]): Promise<void> {
  const checkpoint: Checkpoint = {
    version: 1,
    idea: ctx.idea,
    completedAgents,
    lastAgentIndex: agentIndex,
    timestamp: new Date().toISOString(),
    analysis: ctx.analysis,
    spec: ctx.spec,
    generatedFiles: ctx.generatedFiles,
    buildLogs: ctx.buildLogs,
    testLogs: ctx.testLogs,
  };
  const cpPath = path.join(ctx.workspacePath, CHECKPOINT_FILE);
  await fs.mkdir(ctx.workspacePath, { recursive: true });
  await fs.writeFile(cpPath, JSON.stringify(checkpoint, null, 2), "utf-8");
  log("DEBUG", `Checkpoint saved at agent ${agentIndex} → ${cpPath}`);
}

async function loadCheckpoint(projectPath: string): Promise<Checkpoint | null> {
  const cpPath = path.join(projectPath, CHECKPOINT_FILE);
  try {
    const raw = await fs.readFile(cpPath, "utf-8");
    const cp = JSON.parse(raw) as Checkpoint;
    if (!cp.version || !cp.idea || !Array.isArray(cp.completedAgents)) {
      log("WARN", "Invalid checkpoint file — starting fresh");
      return null;
    }
    return cp;
  } catch {
    return null;
  }
}

function restoreContext(cp: Checkpoint, projectPath: string): SharedContext {
  return {
    idea: cp.idea,
    workspacePath: projectPath,
    analysis: cp.analysis,
    spec: cp.spec,
    generatedFiles: cp.generatedFiles,
    buildLogs: cp.buildLogs,
    testLogs: cp.testLogs,
    errors: [],
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  ORCHESTRATOR
// ═════════════════════════════════════════════════════════════════════════════

function createContext(idea: string, outputDir: string): SharedContext {
  return {
    idea,
    workspacePath: outputDir,
    analysis: null,
    spec: null,
    generatedFiles: [],
    buildLogs: [],
    testLogs: [],
    errors: [],
  };
}

async function orchestrate(idea: string, resumePath?: string): Promise<void> {
  let ctx: SharedContext;
  let projectDir: string;
  let startIndex = 0;
  const completedAgents: number[] = [];

  if (resumePath) {
    // ── RESUME MODE ──────────────────────────────────────────────
    projectDir = path.resolve(resumePath);
    const checkpoint = await loadCheckpoint(projectDir);

    if (!checkpoint) {
      log("ERROR", `No valid checkpoint found in ${projectDir}`);
      log("INFO", "Make sure the path contains a .agent-checkpoint.json file");
      process.exitCode = 1;
      return;
    }

    ctx = restoreContext(checkpoint, projectDir);
    completedAgents.push(...checkpoint.completedAgents);

    // If all 6 agents completed → restart from agent 1
    if (checkpoint.completedAgents.length >= 6) {
      log("INFO", "All agents were completed. Restarting pipeline from Agent 1…");
      startIndex = 0;
      completedAgents.length = 0; // reset
    } else {
      startIndex = checkpoint.lastAgentIndex + 1;
    }

    log("INFO", `Resuming project from checkpoint`);
    log("INFO", `  Original idea: ${checkpoint.idea}`);
    log("INFO", `  Completed agents: ${checkpoint.completedAgents.map(i => i + 1).join(", ") || "none"}`);
    log("INFO", `  Resuming from agent ${startIndex + 1}`);
  } else {
    // ── NEW PROJECT MODE ─────────────────────────────────────────
    const outputRoot = path.resolve(process.env.OUTPUT_DIR ?? "./output");
    projectDir = path.join(outputRoot, `project-${Date.now()}`);
    ctx = createContext(idea, projectDir);
  }

  const agents: AgentStep[] = [
    {
      name: "1 › Idea Analyzer",
      description: "Analyzes the idea, extracts features and tech stack",
      run: ideaAnalyzer,
      kind: "analysis",
    },
    {
      name: "2 › Spec Builder",
      description: "Creates detailed project specification and file structure",
      run: specBuilder,
      kind: "spec",
    },
    {
      name: "3 › Code Generator",
      description: "Generates complete source code for every file",
      run: codeGenerator,
      kind: "codegen",
    },
    {
      name: "4 › Build & Auto-Fix",
      description: "Installs deps, builds project, auto-fixes errors (max 5 retries)",
      run: buildAndFixAgent,
      kind: "build",
    },
    {
      name: "5 › Test Runner",
      description: "Runs the project test suite",
      run: testRunner,
      kind: "test",
    },
    {
      name: "6 › Git Commit",
      description: "Initializes repo and creates initial commit",
      run: gitCommitAgent,
      kind: "commit",
    },
  ];

  const banner = [
    "",
    "╔══════════════════════════════════════════════════════════════╗",
    "║           AI CODING AGENT ORCHESTRATOR                     ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    `  Idea    : ${ctx.idea}`,
    `  Output  : ${projectDir}`,
    `  LLM     : ${USE_MOCK ? "MOCK (no API key)" : process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514"}`,
    `  Agents  : ${agents.length}`,
    ...(resumePath
      ? [
          `  Mode    : 🔄 RESUME from agent ${startIndex + 1}`,
          `  Done    : ${completedAgents.map(i => i + 1).join(", ") || "none"}`,
        ]
      : [`  Mode    : 🆕 New project`]),
    "",
  ];
  console.log(banner.join("\n"));

  for (let agentIdx = startIndex; agentIdx < agents.length; agentIdx++) {
    const agent = agents[agentIdx];

    // Skip already-completed agents
    if (completedAgents.includes(agentIdx)) {
      log("INFO", `Skipping ${agent.name} (already completed)`);
      continue;
    }

    console.log(`\n${"═".repeat(60)}`);
    log("INFO", `Starting: ${agent.name}`);
    log("INFO", agent.description);

    let result = await agent.run(ctx);

    displayResult(agent.name, result);

    if (!result.success) {
      log("ERROR", `Pipeline stopped — ${agent.name} failed: ${result.error}`);
      ctx.errors.push(result.error ?? "Unknown error");
      // Save checkpoint so user can resume after fixing
      await saveCheckpoint(ctx, agentIdx > 0 ? agentIdx - 1 : -1, completedAgents);
      log("INFO", `Checkpoint saved — resume later with: node dist/agent.js --resume ${projectDir}`);
      stopDevServer();
      process.exitCode = 1;
      return;
    }

    // ── Post-agent outputs ───────────────────────────────────────
    if (agent.kind === "analysis" && ctx.analysis) {
      await generateIdeaMd(ctx);
    }
    if (agent.kind === "spec" && ctx.spec) {
      await generateSpecMd(ctx);
    }

    // ── Start dev server for live preview (after codegen or build) ───
    const needsDevServer = agent.kind === "build" || agent.kind === "codegen";
    if (needsDevServer) {
      // Ensure the router script exists for PHP preview
      const routerPath = path.join(ctx.workspacePath, ".router.php");
      if (!existsSync(routerPath)) {
        // Run a quick runtimeCheck which will create the .router.php
        log("INFO", "Creating PHP router for preview…");
        await runtimeCheck(ctx.workspacePath);
      }

      // ── Runtime check: fetch pages, detect crashes, auto-fix ───
      const RUNTIME_FIX_MAX = 3;
      for (let rAttempt = 1; rAttempt <= RUNTIME_FIX_MAX; rAttempt++) {
        log("INFO", `Runtime check (attempt ${rAttempt}/${RUNTIME_FIX_MAX})…`);
        const rtResult = await runtimeCheck(ctx.workspacePath);

        if (rtResult.success) {
          log("INFO", "Runtime check passed ✓ — no errors detected");
          break;
        }

        log("WARN", `Runtime check found ${rtResult.errors.length} error(s)`);
        for (const e of rtResult.errors) {
          log("WARN", `  • ${e.split("\n")[0]}`);
        }

        if (rAttempt === RUNTIME_FIX_MAX) {
          log("WARN", "Max runtime fix attempts reached — continuing with known issues");
          break;
        }

        // ── Auto-fix runtime errors via LLM ──────────────────────
        log("INFO", "Sending runtime errors to LLM for auto-fix…");

        // Collect broken files from error messages
        const brokenFiles = new Set<string>();
        for (const err of rtResult.errors) {
          const fileMatches = err.matchAll(/([^\s:]+\.php)/g);
          for (const m of fileMatches) brokenFiles.add(m[1]);
        }

        // Always include inc/ and template-parts/ (common source of runtime errors)
        try {
          const incDir = path.join(ctx.workspacePath, "inc");
          const incFiles = await fs.readdir(incDir).catch(() => [] as string[]);
          for (const f of incFiles) {
            if (f.endsWith(".php")) brokenFiles.add(`inc/${f}`);
          }
        } catch { /* no inc dir */ }

        try {
          const tpDir = path.join(ctx.workspacePath, "template-parts");
          const tpFiles = await fs.readdir(tpDir).catch(() => [] as string[]);
          for (const f of tpFiles) {
            if (f.endsWith(".php")) brokenFiles.add(`template-parts/${f}`);
          }
        } catch { /* no template-parts dir */ }

        // Also include root PHP files
        try {
          const rootFiles = await fs.readdir(ctx.workspacePath);
          for (const f of rootFiles) {
            if (f.endsWith(".php") && f !== ".router.php") brokenFiles.add(f);
          }
        } catch { /* skip */ }

        // Read file contents
        const fileContents: string[] = [];
        for (const relPath of brokenFiles) {
          try {
            const content = await fs.readFile(path.join(ctx.workspacePath, relPath), "utf-8");
            fileContents.push(`=== ${relPath} ===\n${content}`);
          } catch { /* skip unreadable */ }
        }

        const fixPrompt = `You are fixing RUNTIME errors in a WordPress PHP theme.

RUNTIME ERRORS:
${rtResult.errors.join("\n\n")}

RELEVANT SERVER OUTPUT:
${(rtResult.serverOutput ?? "").slice(-3000)}

SOURCE FILES:
${fileContents.join("\n\n")}

COMMON PHP RUNTIME ERROR PATTERNS:
- "Call to undefined function" → function not defined or file not included via require_once
- "Undefined array key" → accessing array key that doesn't exist, use isset() or ??
- "Undefined variable" → variable not initialized, check scope
- Missing ABSPATH check → add if ( ! defined( 'ABSPATH' ) ) { exit; }
- Wrong include path → use get_template_part() for template-parts/, require_once for inc/

Return a JSON object with:
{
  "explanation": "what you fixed and why",
  "files": [
    { "path": "template-parts/hero.php", "content": "...full corrected file content..." }
  ]
}

RULES:
- Fix ALL runtime errors, not just the first one
- Use proper WordPress escaping: esc_html(), esc_attr(), esc_url()
- Ensure all data functions are defined and loaded
- Return COMPLETE file contents, not patches`;

        try {
          const rtFix = (await callLLM(fixPrompt)) as { explanation?: string; files?: Array<{ path: string; content: string }> };
          if (rtFix.files && Array.isArray(rtFix.files)) {
            for (const f of rtFix.files) {
              const filePath = path.join(ctx.workspacePath, f.path);
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              await fs.writeFile(filePath, f.content, "utf-8");
              log("INFO", `  Fixed: ${f.path}`);
            }
            log("INFO", `Runtime fix applied: ${rtFix.explanation ?? "see files"}`);
          }
        } catch (fixErr: unknown) {
          const msg = fixErr instanceof Error ? fixErr.message : String(fixErr);
          log("ERROR", `LLM runtime fix failed: ${msg}`);
          break;
        }

        // Wait before next runtime check
        await sleep(3000);
      }

      // Start the preview dev server for user review
      startDevServer(ctx.workspacePath);
      await sleep(3000); // Give PHP dev server time to start

      // Final validation: check the live preview for PHP errors and auto-fix
      await preReviewValidation(ctx);
    }

    // ── Interactive review loop (all agents) ─────────────────────
    let reviewing = true;
    while (reviewing) {
      const choice = await askAgentReview(agent.kind);

      switch (choice.action) {
        case "approve":
          reviewing = false;
          if (needsDevServer) stopDevServer();
          // Save checkpoint after approval
          completedAgents.push(agentIdx);
          await saveCheckpoint(ctx, agentIdx, completedAgents);
          log("INFO", `Checkpoint saved — agent ${agentIdx + 1} completed`);
          break;

        case "change":
          if (choice.feedback) {
            // Apply change based on agent kind
            switch (agent.kind) {
              case "analysis":
                await applyAnalysisChange(ctx, choice.feedback);
                break;
              case "spec":
                await applySpecChange(ctx, choice.feedback);
                break;
              case "codegen":
              case "build":
              case "test":
                await applyCodeChange(ctx, choice.feedback);
                // Rebuild if we have source files
                if (agent.kind === "build" || agent.kind === "codegen") {
                  log("INFO", "Rebuilding after changes…");
                  const phpFiles = execSafe(`find . -name "*.php" ! -name ".router.php"`, ctx.workspacePath);
                  const filesToCheck = phpFiles.success ? phpFiles.stdout.trim().split("\n").filter(Boolean) : [];
                  let lintOk = true;
                  for (const f of filesToCheck) {
                    const r = execSafe(`php -l "${f}"`, ctx.workspacePath);
                    if (!r.success) { lintOk = false; break; }
                  }
                  const rebuild = { success: lintOk };
                  if (rebuild.success) {
                    // Restart dev server to pick up changes and validate
                    stopDevServer();
                    startDevServer(ctx.workspacePath);
                    await sleep(3000);
                    await preReviewValidation(ctx);
                    console.log("\n  ✅ Rebuild successful — refresh browser to see changes");
                  } else {
                    console.log("\n  ⚠️  Rebuild failed — running auto-fix…");
                    const fixResult = await buildAndFixAgent(ctx);
                    if (fixResult.success) {
                      console.log("  ✅ Auto-fix successful — refresh browser");
                    } else {
                      console.log("  ❌ Auto-fix failed. Try another change or approve as-is.");
                    }
                  }
                }
                break;
              case "commit":
                // For commit, just re-run with new message preference stored in feedback
                ctx.errors.push(`commit_msg_hint:${choice.feedback}`);
                break;
            }
          }
          break;

        case "regenerate":
          log("INFO", `Re-running ${agent.name} from scratch…`);
          if (needsDevServer) stopDevServer();
          result = await agent.run(ctx);
          displayResult(agent.name, result);

          if (!result.success) {
            log("ERROR", `Pipeline stopped — ${agent.name} failed on regenerate: ${result.error}`);
            stopDevServer();
            process.exitCode = 1;
            return;
          }

          // Re-generate docs if applicable
          if (agent.kind === "analysis" && ctx.analysis) await generateIdeaMd(ctx);
          if (agent.kind === "spec" && ctx.spec) await generateSpecMd(ctx);
          if (needsDevServer) {
            startDevServer(ctx.workspacePath);
            await sleep(4000);
            await preReviewValidation(ctx);
          }
          break;

        case "quit":
          reviewing = false;
          stopDevServer();
          // Agent already ran successfully — mark it completed so resume skips it
          completedAgents.push(agentIdx);
          await saveCheckpoint(ctx, agentIdx, completedAgents);
          log("INFO", `Checkpoint saved — resume later with: node dist/agent.js --resume ${projectDir}`);
          log("WARN", "Pipeline stopped by user during review");
          return;
      }
    }
  }

  stopDevServer();
  // Save final checkpoint
  await saveCheckpoint(ctx, agents.length - 1, completedAgents);
  console.log(`\n${"═".repeat(60)}`);
  console.log("  ✅ Pipeline completed successfully!");
  console.log(`  📁 Project: ${projectDir}`);
  console.log(`  🔄 Resume:  node dist/agent.js --resume ${projectDir}`);
  console.log(`${"═".repeat(60)}\n`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  REGEN-IDEA — Re-run analysis step and overwrite IDEA.md in-place
// ═════════════════════════════════════════════════════════════════════════════

async function regenIdea(projectPath: string, idea: string): Promise<void> {
  const absPath = path.resolve(projectPath);
  if (!existsSync(absPath)) {
    console.error(`Error: Project path does not exist: ${absPath}`);
    process.exitCode = 1;
    return;
  }

  const ctx: SharedContext = {
    idea,
    workspacePath: absPath,
    analysis: null,
    spec: null,
    generatedFiles: [],
    buildLogs: [],
    testLogs: [],
    errors: [],
  };

  log("INFO", `Re-generating IDEA.md for: ${absPath}`);
  log("INFO", `Idea: "${idea}"`);

  const result = await ideaAnalyzer(ctx);
  if (!result.success) {
    console.error(`Analysis failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  await generateIdeaMd(ctx);
  console.log(`\n✅  IDEA.md updated at ${path.join(absPath, "IDEA.md")}`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  CLI ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  node agent.js "<your idea>"                              # New project
  node dist/agent.js --resume <project-path>                    # Resume existing project
  node dist/agent.js --regen-idea <project-path> "<idea>"       # Rewrite IDEA.md only

Examples:
  node dist/agent.js "build a landing page for selling bikes"
  node dist/agent.js --resume ./output/project-1775238748739
  node dist/agent.js --regen-idea ./output/project-xxx "sell premium batteries online"

Environment:
  ANTHROPIC_API_KEY   Claude API key (omit for mock/demo mode)
  CLAUDE_MODEL        Model name (default: claude-sonnet-4-20250514)
  LOG_LEVEL           DEBUG | INFO | WARN | ERROR
  AUTO_APPROVE        "true" to skip approval prompts
  OUTPUT_DIR          Root for generated projects (default: ./output)
`);
    return;
  }

  // ── Regen-idea mode ──────────────────────────────────────────────
  const regenIdx = args.indexOf("--regen-idea");
  if (regenIdx !== -1) {
    const projectPath = args[regenIdx + 1];
    const idea = args.slice(regenIdx + 2).join(" ");
    if (!projectPath || !idea) {
      console.error("Error: --regen-idea requires a project path and an idea string");
      console.error("Example: node agent.js --regen-idea ./output/project-xxx \"sell premium batteries\"");
      process.exitCode = 1;
      return;
    }
    await regenIdea(projectPath, idea);
    return;
  }

  // ── Resume mode ────────────────────────────────────────────────
  const resumeIdx = args.indexOf("--resume");
  if (resumeIdx !== -1) {
    const projectPath = args[resumeIdx + 1];
    if (!projectPath) {
      console.error("Error: --resume requires a project path");
      console.error("Example: node dist/agent.js --resume ./output/project-1775238748739");
      process.exitCode = 1;
      return;
    }
    const absPath = path.resolve(projectPath);
    if (!existsSync(absPath)) {
      console.error(`Error: Project path does not exist: ${absPath}`);
      process.exitCode = 1;
      return;
    }
    await orchestrate("", absPath);
    return;
  }

  // ── Auto-detect: if arg looks like a path to an existing project, resume it ──
  const firstArg = args[0];
  if (
    firstArg &&
    (firstArg.startsWith("./") || firstArg.startsWith("/") || firstArg.startsWith("output/")) &&
    existsSync(path.resolve(firstArg))
  ) {
    const absPath = path.resolve(firstArg);
    const hasCheckpoint = existsSync(path.join(absPath, CHECKPOINT_FILE));
    if (hasCheckpoint) {
      log("INFO", `Detected existing project with checkpoint — resuming`);
      await orchestrate("", absPath);
      return;
    }
  }

  // ── New project mode ──────────────────────────────────────────
  const idea = args.join(" ");
  await orchestrate(idea);
}

main().catch((err) => {
  log("ERROR", "Fatal error", { message: err.message, stack: err.stack });
  process.exitCode = 1;
});
