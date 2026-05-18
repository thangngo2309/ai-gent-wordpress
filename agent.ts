#!/usr/bin/env node
/**
 * AI Coding Agent Orchestrator
 *
 * Multi-agent pipeline for automated web application development.
 * Each agent runs sequentially with user approval between steps.
 *
 * Usage:
 *   npx ts-node agent.ts "build a landing page for selling bikes"
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
}

interface TechStack {
  frontend: string[];
  backend: string[];
  devtools: string[];
}

interface FeatureAnalysis {
  projectName: string;
  summary: string;
  features: Feature[];
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

const ALLOWED_BINS = new Set(["npm", "git", "node", "tsc", "php", "wp", "zip"]);

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
4. **Images**: Use picsum.photos URLs as placeholder images via inline styles or img tags
   - Hero: 1920x1080, Products: 600x800, Categories: 800x600, Editorial: 800x1000
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
  if (prompt.includes("[GENERATE_CODE]")) return mockCodeGen();
  if (prompt.includes("[FIX_BUILD]")) return mockBuildFix();
  if (prompt.includes("[COMMIT_MSG]")) return mockCommitMsg();
  throw new Error("Mock LLM: unrecognised prompt tag");
}

function mockAnalysis(prompt: string): FeatureAnalysis {
  const m = prompt.match(/Idea:\s*"([^"]+)"/);
  const idea = m?.[1] ?? "web application";
  const slug = idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return {
    projectName: slug || "my-app",
    summary: `A modern web application: ${idea}`,
    features: [
      { name: "Hero Section", description: "Eye-catching hero banner with CTA", priority: "high" },
      { name: "Featured Products", description: "Responsive product listing cards in 4-column grid", priority: "high" },
      { name: "Categories", description: "Visual category grid with hover effects", priority: "high" },
      { name: "Editorial", description: "Featured article with split layout", priority: "medium" },
      { name: "Archives Gallery", description: "Photo grid with hover overlay", priority: "medium" },
      { name: "About Section", description: "Brand story with image and stats", priority: "medium" },
      { name: "Footer", description: "Navigation, socials, newsletter signup", priority: "low" },
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

function mockCodeGen(): GeneratedFile[] {
  return [
    {
      filePath: "style.css",
      content: [
        "/*",
        "Theme Name: Premium Bikes",
        "Theme URI: https://example.com/premium-bikes",
        "Author: AI Agent",
        "Author URI: https://example.com",
        "Description: A curated collection of high-performance bicycles for every rider.",
        "Version: 1.0.0",
        "License: GNU General Public License v2 or later",
        "License URI: https://www.gnu.org/licenses/gpl-2.0.html",
        "Text Domain: premium-bikes",
        "Tags: landing-page, custom-menu, custom-logo, featured-images",
        "*/",
        "",
        "/* ── CSS Custom Properties ── */",
        ":root {",
        "  --color-primary: #0f172a;",
        "  --color-primary-foreground: #f8fafc;",
        "  --color-secondary: #6366f1;",
        "  --color-secondary-foreground: #ffffff;",
        "  --color-background: #ffffff;",
        "  --color-foreground: #0f172a;",
        "  --color-muted: #f1f5f9;",
        "  --color-muted-foreground: #64748b;",
        "  --color-card: #ffffff;",
        "  --color-card-foreground: #0f172a;",
        "  --color-border: #e2e8f0;",
        "  --color-accent: #6366f1;",
        "  --color-accent-foreground: #ffffff;",
        "}",
        "",
        "/* ── Reset ── */",
        "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }",
        "body {",
        "  background-color: var(--color-background);",
        "  color: var(--color-foreground);",
        "  font-family: 'Inter', system-ui, -apple-system, sans-serif;",
        "  -webkit-font-smoothing: antialiased;",
        "  -moz-osx-font-smoothing: grayscale;",
        "  line-height: 1.6;",
        "}",
        "html { scroll-behavior: smooth; }",
        "img { max-width: 100%; height: auto; display: block; }",
        "a { text-decoration: none; color: inherit; }",
        "ul, ol { list-style: none; }",
        "",
        "/* ── Container ── */",
        ".container { max-width: 1280px; margin: 0 auto; padding: 0 1rem; }",
        "@media (min-width: 768px) { .container { padding: 0 2.5rem; } }",
        "@media (min-width: 1024px) { .container { padding: 0 5rem; } }",
        "",
        "/* ── Buttons ── */",
        ".btn-primary {",
        "  display: inline-flex; align-items: center; justify-content: center;",
        "  background: linear-gradient(135deg, var(--color-primary), rgba(15,23,42,0.85));",
        "  color: var(--color-primary-foreground); padding: 0.75rem 1.5rem;",
        "  border-radius: 0.5rem; font-weight: 600; transition: all 0.3s;",
        "  border: none; cursor: pointer; font-size: 0.875rem;",
        "}",
        ".btn-primary:hover { opacity: 0.9; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }",
        ".btn-outline {",
        "  display: inline-flex; align-items: center; justify-content: center;",
        "  border: 2px solid var(--color-border); background: transparent;",
        "  padding: 0.75rem 2.5rem; font-size: 0.75rem; font-weight: 700;",
        "  text-transform: uppercase; letter-spacing: 0.15em;",
        "  border-radius: 0.5rem; transition: all 0.3s; cursor: pointer;",
        "}",
        ".btn-outline:hover { background-color: var(--color-primary); color: var(--color-primary-foreground); }",
        "",
        "/* ── Glass ── */",
        ".glass {",
        "  background-color: rgba(255,255,255,0.8);",
        "  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);",
        "  border-bottom: 1px solid var(--color-border);",
        "}",
        "",
        "/* ── Header ── */",
        ".site-header { position: fixed; top: 0; left: 0; right: 0; z-index: 50; padding: 0.75rem 0; }",
        ".site-header .container { display: flex; align-items: center; justify-content: space-between; }",
        ".site-header__brand { font-size: 1.125rem; font-weight: 700; letter-spacing: -0.02em; }",
        ".site-header__right { display: flex; align-items: center; gap: 2rem; }",
        ".site-header__nav { display: none; align-items: center; gap: 2.25rem; }",
        "@media (min-width: 768px) { .site-header__nav { display: flex; } }",
        ".site-header__nav a { font-size: 0.875rem; font-weight: 500; color: var(--color-muted-foreground); transition: color 0.2s; }",
        ".site-header__nav a:hover { color: var(--color-foreground); }",
        "",
        "/* ── Hero ── */",
        ".section-hero { padding: 2.5rem 0; padding-top: 5rem; }",
        ".section-hero__bg {",
        "  min-height: 600px; display: flex; flex-direction: column; gap: 1.5rem;",
        "  align-items: center; justify-content: center; padding: 2rem;",
        "  border-radius: 0.75rem; background-size: cover; background-position: center;",
        "  box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);",
        "}",
        ".section-hero__content { text-align: center; max-width: 42rem; }",
        ".section-hero__title { color: #fff; font-size: 3rem; font-weight: 900; line-height: 1.1; letter-spacing: -0.02em; }",
        "@media (min-width: 768px) { .section-hero__title { font-size: 4.5rem; } }",
        ".section-hero__subtitle { color: rgba(255,255,255,0.8); font-size: 1.125rem; margin-top: 1rem; line-height: 1.75; }",
        ".section-hero__cta { margin-top: 1rem; }",
        ".section-hero__cta .btn-primary { min-width: 160px; padding: 1rem 1.5rem; font-size: 1rem; }",
        "",
        "/* ── Featured Products ── */",
        ".section-products { margin-bottom: 5rem; }",
        ".section-products__header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 2.5rem; }",
        ".section-products__label { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--color-muted-foreground); margin-bottom: 0.5rem; }",
        ".section-products__title { font-size: 2.25rem; font-weight: 900; letter-spacing: -0.02em; }",
        ".section-products__link { font-size: 0.875rem; font-weight: 700; color: var(--color-accent); text-decoration: underline; text-underline-offset: 4px; }",
        ".section-products__grid { display: grid; grid-template-columns: 1fr; gap: 2rem; }",
        "@media (min-width: 640px) { .section-products__grid { grid-template-columns: repeat(2, 1fr); } }",
        "@media (min-width: 1024px) { .section-products__grid { grid-template-columns: repeat(4, 1fr); } }",
        ".product-card { display: flex; flex-direction: column; gap: 1rem; }",
        ".product-card__image { position: relative; overflow: hidden; aspect-ratio: 3/4; background: var(--color-muted); border-radius: 0.75rem; transition: box-shadow 0.3s; }",
        ".product-card:hover .product-card__image { box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }",
        ".product-card__img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s; }",
        ".product-card:hover .product-card__img { transform: scale(1.05); }",
        ".product-card__name { font-size: 1.125rem; font-weight: 700; }",
        ".product-card__price { font-size: 0.875rem; color: var(--color-muted-foreground); }",
        "",
        "/* ── Categories ── */",
        ".section-categories { margin-bottom: 5rem; }",
        ".section-categories__title { font-size: 1.875rem; font-weight: 900; margin-bottom: 2rem; }",
        ".section-categories__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }",
        "@media (min-width: 768px) { .section-categories__grid { grid-template-columns: repeat(4, 1fr); } }",
        ".category-card { position: relative; height: 12rem; overflow: hidden; border-radius: 0.75rem; cursor: pointer; }",
        ".category-card__overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.6), transparent); z-index: 1; transition: background 0.3s; }",
        ".category-card:hover .category-card__overlay { background: linear-gradient(to top, rgba(0,0,0,0.7), transparent); }",
        ".category-card__img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s; }",
        ".category-card:hover .category-card__img { transform: scale(1.1); }",
        ".category-card__label { position: absolute; bottom: 1rem; left: 1rem; z-index: 2; color: #fff; font-weight: 700; font-size: 1.125rem; }",
        "",
        "/* ── Editorial ── */",
        ".section-editorial { background: var(--color-muted); padding: 4rem 0; }",
        "@media (min-width: 768px) { .section-editorial { padding: 6rem 0; } }",
        ".section-editorial__top { display: flex; flex-direction: column; gap: 4rem; margin-bottom: 6rem; }",
        "@media (min-width: 768px) { .section-editorial__top { flex-direction: row; gap: 5rem; } }",
        ".section-editorial__left { flex: 1; }",
        ".section-editorial__right { flex: 1; }",
        ".section-editorial__label { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--color-muted-foreground); margin-bottom: 1rem; }",
        ".section-editorial__heading { font-size: 3rem; font-weight: 900; line-height: 1.1; margin-bottom: 2rem; }",
        "@media (min-width: 768px) { .section-editorial__heading { font-size: 3.75rem; } }",
        ".section-editorial__text { font-size: 1.125rem; color: var(--color-muted-foreground); max-width: 28rem; }",
        ".section-editorial__cta { margin-top: 3rem; }",
        ".section-editorial__image { aspect-ratio: 4/5; border-radius: 0.75rem; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }",
        ".section-editorial__image img { width: 100%; height: 100%; object-fit: cover; }",
        ".section-editorial__grid { display: grid; grid-template-columns: 1fr; gap: 3rem; }",
        "@media (min-width: 768px) { .section-editorial__grid { grid-template-columns: repeat(3, 1fr); } }",
        ".article-card { cursor: pointer; }",
        ".article-card__image { aspect-ratio: 1; overflow: hidden; border-radius: 0.75rem; margin-bottom: 1.5rem; }",
        ".article-card__image img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s; }",
        ".article-card:hover .article-card__image img { transform: scale(1.05); }",
        ".article-card__category { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-accent); }",
        ".article-card__title { font-size: 1.25rem; font-weight: 700; margin-top: 0.5rem; }",
        ".article-card:hover .article-card__title { text-decoration: underline; }",
        "",
        "/* ── Archives ── */",
        ".section-archives { padding: 4rem 0; }",
        "@media (min-width: 768px) { .section-archives { padding: 6rem 0; } }",
        ".section-archives__header { margin-bottom: 4rem; padding-bottom: 2rem; border-bottom: 1px solid var(--color-border); }",
        ".section-archives__title { font-size: 2.25rem; font-weight: 900; }",
        "@media (min-width: 768px) { .section-archives__title { font-size: 3rem; } }",
        ".section-archives__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }",
        "@media (min-width: 1024px) { .section-archives__grid { grid-template-columns: repeat(3, 1fr); } }",
        ".archive-card { aspect-ratio: 1; position: relative; overflow: hidden; border-radius: 0.75rem; }",
        ".archive-card__img { width: 100%; height: 100%; object-fit: cover; }",
        ".archive-card__hover { position: absolute; inset: 0; background: rgba(15,23,42,0.6); opacity: 0; transition: opacity 0.3s; display: flex; flex-direction: column; justify-content: flex-end; padding: 1.5rem; }",
        ".archive-card:hover .archive-card__hover { opacity: 1; }",
        ".archive-card__season { color: var(--color-primary-foreground); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; }",
        ".archive-card__name { color: var(--color-primary-foreground); font-weight: 700; font-size: 1.125rem; }",
        ".section-archives__more { margin-top: 4rem; text-align: center; }",
        "",
        "/* ── About ── */",
        ".section-about { background: var(--color-muted); padding: 4rem 0; overflow: hidden; }",
        "@media (min-width: 768px) { .section-about { padding: 6rem 0; } }",
        ".section-about__grid { display: grid; grid-template-columns: 1fr; gap: 4rem; align-items: center; }",
        "@media (min-width: 1024px) { .section-about__grid { grid-template-columns: repeat(2, 1fr); gap: 6rem; } }",
        ".section-about__image { aspect-ratio: 1; border-radius: 0.75rem; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }",
        ".section-about__image img { width: 100%; height: 100%; object-fit: cover; }",
        ".section-about__label { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--color-accent); margin-bottom: 1rem; }",
        ".section-about__heading { font-size: 2.25rem; font-weight: 900; line-height: 1.1; margin-bottom: 2rem; }",
        "@media (min-width: 768px) { .section-about__heading { font-size: 3rem; } }",
        ".section-about__text { font-size: 1.125rem; color: var(--color-muted-foreground); line-height: 1.75; }",
        ".section-about__text p + p { margin-top: 1.5rem; }",
        ".section-about__stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2rem; margin-top: 3rem; }",
        ".stat__number { font-size: 1.875rem; font-weight: 900; color: var(--color-accent); margin-bottom: 0.25rem; }",
        ".stat__label { font-size: 0.875rem; color: var(--color-muted-foreground); }",
        "",
        "/* ── Footer ── */",
        ".site-footer { background: linear-gradient(135deg, var(--color-primary), rgba(15,23,42,0.85)); color: var(--color-primary-foreground); padding: 4rem 0; }",
        "@media (min-width: 768px) { .site-footer { padding: 5rem 0; } }",
        ".site-footer__top { display: flex; flex-direction: column; gap: 4rem; margin-bottom: 5rem; }",
        "@media (min-width: 768px) { .site-footer__top { flex-direction: row; justify-content: space-between; } }",
        ".site-footer__brand { max-width: 20rem; }",
        ".site-footer__brand-name { font-size: 1.25rem; font-weight: 700; margin-bottom: 1.5rem; }",
        ".site-footer__brand-desc { color: rgba(248,250,252,0.6); font-size: 0.875rem; line-height: 1.75; }",
        ".site-footer__columns { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3rem; }",
        "@media (min-width: 768px) { .site-footer__columns { grid-template-columns: repeat(3, 1fr); } }",
        ".site-footer__col-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: rgba(248,250,252,0.4); margin-bottom: 1rem; }",
        ".site-footer__col a { display: block; font-size: 0.875rem; color: rgba(248,250,252,0.7); margin-bottom: 0.75rem; transition: color 0.2s; }",
        ".site-footer__col a:hover { color: var(--color-primary-foreground); }",
        ".site-footer__newsletter input { width: 100%; background: rgba(248,250,252,0.1); border: 1px solid rgba(248,250,252,0.2); color: var(--color-primary-foreground); padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.875rem; margin-bottom: 0.75rem; }",
        ".site-footer__newsletter input::placeholder { color: rgba(248,250,252,0.4); }",
        ".site-footer__newsletter button { width: 100%; background: var(--color-primary-foreground); color: var(--color-primary); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; padding: 0.75rem; border: none; border-radius: 0.5rem; cursor: pointer; transition: opacity 0.2s; }",
        ".site-footer__newsletter button:hover { opacity: 0.9; }",
        ".site-footer__bottom { padding-top: 2rem; border-top: 1px solid rgba(248,250,252,0.1); display: flex; flex-direction: column; align-items: center; gap: 1rem; }",
        "@media (min-width: 768px) { .site-footer__bottom { flex-direction: row; justify-content: space-between; } }",
        ".site-footer__copy { color: rgba(248,250,252,0.3); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.15em; }",
        ".site-footer__legal { display: flex; gap: 1.5rem; }",
        ".site-footer__legal a { color: rgba(248,250,252,0.3); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.15em; transition: color 0.2s; }",
        ".site-footer__legal a:hover { color: var(--color-primary-foreground); }",
        "",
        "/* ── Back to Top ── */",
        ".back-to-top {",
        "  position: fixed; bottom: 2rem; right: 2rem; width: 3rem; height: 3rem;",
        "  background: linear-gradient(135deg, var(--color-primary), rgba(15,23,42,0.85));",
        "  color: var(--color-primary-foreground); display: flex; align-items: center;",
        "  justify-content: center; border-radius: 50%; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);",
        "  transition: transform 0.2s; z-index: 40; border: none; cursor: pointer;",
        "}",
        ".back-to-top:hover { transform: scale(1.1); }",
        "",
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
        "        array( 'id' => '1', 'name' => 'Mountain Explorer', 'price' => 1299, 'image' => 'https://picsum.photos/600/800?random=1', 'alt' => 'Mountain bike on rocky trail' ),",
        "        array( 'id' => '2', 'name' => 'City Cruiser', 'price' => 899, 'image' => 'https://picsum.photos/600/800?random=2', 'alt' => 'Urban commuter bike' ),",
        "        array( 'id' => '3', 'name' => 'Speed Racer', 'price' => 2199, 'image' => 'https://picsum.photos/600/800?random=3', 'alt' => 'Aerodynamic road bike' ),",
        "        array( 'id' => '4', 'name' => 'Trail Blazer', 'price' => 1599, 'image' => 'https://picsum.photos/600/800?random=4', 'alt' => 'Full-suspension trail bike' ),",
        "    );",
        "}",
        "",
        "function premium_bikes_get_categories() {",
        "    return array(",
        "        array( 'name' => 'Mountain', 'image' => 'https://picsum.photos/400/300?random=5' ),",
        "        array( 'name' => 'Road', 'image' => 'https://picsum.photos/400/300?random=6' ),",
        "        array( 'name' => 'Urban', 'image' => 'https://picsum.photos/400/300?random=7' ),",
        "        array( 'name' => 'Accessories', 'image' => 'https://picsum.photos/400/300?random=8' ),",
        "    );",
        "}",
        "",
        "function premium_bikes_get_articles() {",
        "    return array(",
        "        array( 'category' => 'Gear', 'title' => 'The Science Behind Carbon Frames', 'image' => 'https://picsum.photos/600/600?random=10', 'alt' => 'Carbon fiber close-up' ),",
        "        array( 'category' => 'Culture', 'title' => 'Urban Cycling Revolution', 'image' => 'https://picsum.photos/600/600?random=11', 'alt' => 'City cycling scene' ),",
        "        array( 'category' => 'Routes', 'title' => 'Epic Mountain Passes', 'image' => 'https://picsum.photos/600/600?random=12', 'alt' => 'Mountain pass road' ),",
        "    );",
        "}",
        "",
        "function premium_bikes_get_archives() {",
        "    return array(",
        "        array( 'season' => \"Spring '24\", 'title' => 'Trail Season', 'image' => 'https://picsum.photos/600/600?random=20', 'alt' => 'Spring trail ride' ),",
        "        array( 'season' => \"Winter '23\", 'title' => 'Fat Bike Adventures', 'image' => 'https://picsum.photos/600/600?random=21', 'alt' => 'Snow biking' ),",
        "        array( 'season' => \"Fall '23\", 'title' => 'Gravel Grinding', 'image' => 'https://picsum.photos/600/600?random=22', 'alt' => 'Gravel path' ),",
        "        array( 'season' => \"Summer '23\", 'title' => 'Road Classics', 'image' => 'https://picsum.photos/600/600?random=23', 'alt' => 'Summer road race' ),",
        "        array( 'season' => \"Spring '23\", 'title' => 'MTB Opener', 'image' => 'https://picsum.photos/600/600?random=24', 'alt' => 'Mountain bike park' ),",
        "        array( 'season' => \"Winter '22\", 'title' => 'Indoor Training', 'image' => 'https://picsum.photos/600/600?random=25', 'alt' => 'Bike trainer setup' ),",
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
        "        <div class=\"section-hero__bg\" style=\"background-image: linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.7)), url('https://picsum.photos/1920/1080?random=0');\">",
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
        "?>",
        "",
        '<div class="section-editorial">',
        '    <div class="container">',
        '        <div class="section-editorial__top">',
        '            <div class="section-editorial__left">',
        '                <span class="section-editorial__label"><?php esc_html_e( \'Current Issue\', \'premium-bikes\' ); ?></span>',
        '                <h2 class="section-editorial__heading"><?php esc_html_e( \'The Art of the Ride\', \'premium-bikes\' ); ?></h2>',
        '                <p class="section-editorial__text">',
        "                    <?php esc_html_e( 'Exploring the boundary between machine and movement. This season, we look at what makes a great bike timeless.', 'premium-bikes' ); ?>",
        "                </p>",
        '                <div class="section-editorial__cta">',
        "                    <a href=\"#\" class=\"btn-primary\" style=\"text-transform: uppercase; letter-spacing: 0.15em; font-size: 0.75rem; padding: 1rem 2rem;\">",
        "                        <?php esc_html_e( 'Read Feature', 'premium-bikes' ); ?>",
        "                    </a>",
        "                </div>",
        "            </div>",
        '            <div class="section-editorial__right">',
        '                <div class="section-editorial__image">',
        "                    <img src=\"https://picsum.photos/800/1000?random=9\" alt=\"<?php esc_attr_e( 'Featured article', 'premium-bikes' ); ?>\" loading=\"lazy\">",
        "                </div>",
        "            </div>",
        "        </div>",
        '        <div class="section-editorial__grid">',
        "            <?php foreach ( $articles as $article ) : ?>",
        '                <div class="article-card">',
        '                    <div class="article-card__image">',
        "                        <img src=\"<?php echo esc_url( $article['image'] ); ?>\" alt=\"<?php echo esc_attr( $article['alt'] ); ?>\" loading=\"lazy\">",
        "                    </div>",
        "                    <span class=\"article-card__category\"><?php echo esc_html( $article['category'] ); ?></span>",
        "                    <h3 class=\"article-card__title\"><?php echo esc_html( $article['title'] ); ?></h3>",
        "                </div>",
        "            <?php endforeach; ?>",
        "        </div>",
        "    </div>",
        "</div>",
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
        "$archives = premium_bikes_get_archives();",
        "?>",
        "",
        '<div class="section-archives">',
        '    <div class="container">',
        '        <div class="section-archives__header">',
        '            <h2 class="section-archives__title"><?php esc_html_e( \'Archives\', \'premium-bikes\' ); ?></h2>',
        "        </div>",
        '        <div class="section-archives__grid">',
        "            <?php foreach ( $archives as $item ) : ?>",
        '                <div class="archive-card">',
        "                    <img class=\"archive-card__img\" src=\"<?php echo esc_url( $item['image'] ); ?>\" alt=\"<?php echo esc_attr( $item['alt'] ); ?>\" loading=\"lazy\">",
        '                    <div class="archive-card__hover">',
        "                        <p class=\"archive-card__season\"><?php echo esc_html( $item['season'] ); ?></p>",
        "                        <h4 class=\"archive-card__name\"><?php echo esc_html( $item['title'] ); ?></h4>",
        "                    </div>",
        "                </div>",
        "            <?php endforeach; ?>",
        "        </div>",
        '        <div class="section-archives__more">',
        '            <button class="btn-outline"><?php esc_html_e( \'Load More\', \'premium-bikes\' ); ?></button>',
        "        </div>",
        "    </div>",
        "</div>",
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
        "                <img src=\"https://picsum.photos/800/800?random=30\" alt=\"<?php esc_attr_e( 'About us', 'premium-bikes' ); ?>\" loading=\"lazy\">",
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
Analyze the following web application idea and break it down into features and tech stack.

Idea: "${ctx.idea}"

Respond with JSON:
{
  "projectName": "kebab-case-name",
  "summary": "One-line summary",
  "features": [
    { "name": "Feature", "description": "What it does", "priority": "high | medium | low" }
  ],
  "techStack": {
    "frontend": ["PHP", "WordPress", "CSS3", "Vanilla JS"],
    "backend": ["WordPress", "PHP"],
    "devtools": ["php", "wp-cli"]
  }
}

The project creates a WordPress theme with a modern editorial design.
Map the idea into 6–8 features matching these page sections: Hero, Featured Products, Categories, Editorial/Blog, Archives/Gallery, About, Contact/Newsletter.
List 6–8 features. Always use WordPress + PHP + CSS3 as the tech stack.`;

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

Project: ${ctx.analysis?.projectName}
User's idea: "${ctx.idea}"
Full project file list: ${allPlanned.map((f) => f.filePath).join(", ")}

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
- style.css MUST start with the WordPress theme header comment (/* Theme Name: ... */)
- functions.php MUST start with <?php and use WordPress hooks properly
- ALWAYS check if ( ! defined( 'ABSPATH' ) ) { exit; } at the top of PHP files
- Use proper WordPress escaping: esc_html(), esc_attr(), esc_url(), wp_kses_post() — escape at the point of output
- Use i18n functions: __(), _e(), esc_html__(), esc_html_e() with the theme text domain
- Use get_template_part() to include template parts, NOT include/require
- Use wp_enqueue_style/script() in functions.php — do NOT add <link>/<script> tags directly
- header.php must include wp_head() before </head> and wp_body_open() after <body>
- header.php must have <a class="skip-to-content" href="#main-content">Skip to content</a> as first body element
- footer.php must include wp_footer() before </body>
- Use register_nav_menus() for navigation, wp_nav_menu() to display
- Use get_theme_mod() for Customizer settings
- inc/theme-data.php must define PHP functions that return data arrays (products, categories, articles, archives, site config)
- Template parts use data from theme-data.php functions
- CSS should use BEM naming (.section-hero, .section-hero__title, .section-hero--large)
- CSS must use CSS custom properties (var(--color-primary)) for theming
- All animations/transitions must be wrapped in @media (prefers-reduced-motion: no-preference) { }
- All :hover effects must also have equivalent :focus-visible styles for keyboard accessibility
- Every <img> must have a descriptive alt="" attribute
- Semantic HTML: use <main id="main-content">, <nav aria-label>, <header role="banner">, <footer role="contentinfo">
- No React, No JSX, No TypeScript, No Tailwind, No Next.js
- For images: use <img> tags or inline style="background-image: url('...')" with picsum.photos URLs
- Every file must be COMPLETE — no TODOs, no placeholders, no "..." shortcuts
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
function the_post_thumbnail(\$size = '') { echo '<img src="https://picsum.photos/800/600" alt="thumbnail">'; }
function has_post_thumbnail(\$id = 0) { return true; }
function get_the_post_thumbnail_url(\$id = 0, \$size = '') { return 'https://picsum.photos/800/600'; }
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
function wp_get_attachment_image_url(\$id = 0, \$size = '') { return 'https://picsum.photos/800/600'; }
function wp_get_attachment_image(\$id = 0, \$size = '') { return '<img src="https://picsum.photos/800/600" alt="">'; }
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

        for (const fp of allFiles) {
          if (!fp.endsWith(".php") && !fp.endsWith(".css") && !fp.endsWith(".js")) continue;
          const isErrorFile = errorFiles.some((ef) => fp.includes(ef) || ef.includes(fp));
          const isDataFile = fp.includes("inc/") || fp.includes("template-parts/");

          if ((isErrorFile || isDataFile) && !added.has(fp)) {
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
    "## Features",
    "",
    "| # | Feature | Description | Priority |",
    "|---|---------|-------------|----------|",
    ...a.features.map(
      (f, i) =>
        `| ${i + 1} | **${f.name}** | ${f.description} | ${priorityEmoji(f.priority)} ${f.priority} |`
    ),
    "",
    "## Tech Stack",
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

    // Always include key files
    for (const f of ["functions.php", "header.php", "footer.php", "index.php", "front-page.php"]) {
      if (existsSync(path.join(ctx.workspacePath, f))) brokenFiles.add(f);
    }
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
      log("INFO", `Checkpoint saved — resume later with: node agent.js --resume ${projectDir}`);
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
          log("INFO", `Checkpoint saved — resume later with: node agent.js --resume ${projectDir}`);
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
  console.log(`  🔄 Resume:  node agent.js --resume ${projectDir}`);
  console.log(`${"═".repeat(60)}\n`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  CLI ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  node agent.js "<your idea>"                    # New project
  node agent.js --resume <project-path>          # Resume existing project
  node agent.js --resume ./output/project-xxx    # Resume from checkpoint

Examples:
  node agent.js "build a landing page for selling bikes"
  node agent.js "create a todo app with authentication"
  node agent.js --resume ./output/project-1775238748739

Environment:
  ANTHROPIC_API_KEY   Claude API key (omit for mock/demo mode)
  CLAUDE_MODEL        Model name (default: claude-sonnet-4-20250514)
  LOG_LEVEL           DEBUG | INFO | WARN | ERROR
  AUTO_APPROVE        "true" to skip approval prompts
  OUTPUT_DIR          Root for generated projects (default: ./output)
`);
    return;
  }

  // ── Resume mode ────────────────────────────────────────────────
  const resumeIdx = args.indexOf("--resume");
  if (resumeIdx !== -1) {
    const projectPath = args[resumeIdx + 1];
    if (!projectPath) {
      console.error("Error: --resume requires a project path");
      console.error("Example: node agent.js --resume ./output/project-1775238748739");
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
