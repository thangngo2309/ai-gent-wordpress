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
import { Dirent, existsSync } from "node:fs";
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

const ALLOWED_BINS = new Set(["pnpm", "npm", "npx", "git", "node", "tsc"]);

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
//  TOOLS — PACKAGE MANAGER DETECTION
// ═════════════════════════════════════════════════════════════════════════════

function detectPM(): "pnpm" | "npm" {
  const check = execSafe("pnpm --version", ".");
  if (check.success) return "pnpm";
  log("WARN", "pnpm not available, falling back to npm");
  return "npm";
}

const PM = detectPM();

// ═════════════════════════════════════════════════════════════════════════════
//  DESIGN SYSTEM — Creative guidelines for Claude (no rigid HTML template)
// ═════════════════════════════════════════════════════════════════════════════

const DESIGN_SYSTEM = `
## Design System Guidelines

You are a creative UI/UX designer. Design a visually stunning, modern landing page.
Be creative with layout, animations, and visual hierarchy — but follow these technical rules:

### Font
- Use Google Font "Inter" via next/font/google with variable "--font-inter"
- Font weights: 400 (body), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold), 900 (black)
- Apply font-smoothing: antialiased

### Color Palette (define ALL in tailwind.config.ts)
Choose a cohesive color palette that matches the user's topic. Include:
- primary, primary-foreground (main brand color + contrast text)
- secondary, secondary-foreground (accent color)
- background, foreground (page bg + default text)
- muted, muted-foreground (subtle backgrounds + dim text)
- card, card-foreground (card surfaces)
- border (borders and dividers)
- accent, accent-foreground (highlights, CTAs)
- destructive (errors)

### Tailwind Config (tailwind.config.ts)
- content: ["./src/**/*.{ts,tsx}"]
- Extend theme with ALL custom colors above
- Add fontFamily: { sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"] }
- Add custom keyframes & animation for subtle entrance effects:
  - "fade-in": opacity 0→1
  - "slide-up": translateY(20px)→0 with opacity
  - "slide-in-left": translateX(-20px)→0

### globals.css
\`\`\`css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* IMPORTANT: Do NOT use @apply inside @layer blocks — it breaks PostCSS compilation.
   Write plain CSS values instead. */

* { border-color: #e2e8f0; }
body {
  background-color: #ffffff;
  color: #0f172a;
  font-family: var(--font-inter), Inter, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
html { scroll-behavior: smooth; }

.glass {
  background-color: rgba(255,255,255,0.8);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,0.2);
}
.gradient-primary { background: linear-gradient(to bottom right, var(--color-primary), rgba(var(--color-primary-rgb),0.8)); }
.gradient-secondary { background: linear-gradient(to bottom right, var(--color-secondary), rgba(var(--color-secondary-rgb),0.8)); }
.text-balance { text-wrap: balance; }
.animate-in { animation: fade-in 0.6s ease-out forwards; }
.animate-slide-up { animation: slide-up 0.6s ease-out forwards; }
.btn-primary {
  background-color: var(--color-primary, #0ea5e9);
  color: #ffffff;
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 600;
  transition: all 0.3s;
}
.btn-primary:hover { opacity: 0.9; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
.btn-outline {
  border: 2px solid var(--color-primary, #0ea5e9);
  color: var(--color-primary, #0ea5e9);
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 600;
  transition: all 0.3s;
}
.btn-outline:hover { background-color: var(--color-primary, #0ea5e9); color: #ffffff; }
\`\`\`

### Component Design Principles
1. **Spacing**: Use generous padding (py-16 md:py-24 lg:py-32 for sections)
2. **Max-width**: Use max-w-7xl mx-auto for content containers
3. **Responsive**: All layouts must work on mobile (grid cols-1 → md:cols-2 → lg:cols-3/4)
4. **Images**: Use div with bg-cover bg-center + picsum.photos URLs (not Next.js <Image>)
   - Hero: 1920x1080, Products: 600/800, Categories: 800x600, Editorial: 800x1000
   - Pattern: style={{ backgroundImage: \`url("https://picsum.photos/WxH?random=N")\` }}
5. **Hover effects**: scale-105, shadow-lg transitions, opacity changes
6. **Shadows**: Use shadow-sm, shadow-md, shadow-xl for depth hierarchy
7. **Rounded corners**: rounded-lg for cards, rounded-xl for featured items, rounded-full for avatars/buttons
8. **Transitions**: transition-all duration-300 for smooth interactions
9. **Typography scale**: text-sm→text-base→text-lg→text-xl→text-2xl→text-4xl→text-5xl→text-6xl
10. **Dark overlays on images**: Use bg-gradient-to-t from-black/60 for text readability

### Page Sections (create each as a separate component)
1. **Header** — Sticky nav with glass morphism, logo, nav links, CTA button
2. **Hero** — Full-width hero with large background, bold headline, subtitle, CTA
3. **FeaturedProducts** — Product cards grid (4 cols on desktop) with hover effects
4. **Categories** — Visual category cards with overlay text
5. **Editorial** — Featured article + article grid (magazine-style layout)
6. **Archives** — Image gallery grid with hover overlay
7. **About** — Split layout: image + text with stats/values
8. **Footer** — Multi-column footer with nav, socials, newsletter
9. **BackToTop** — Fixed bottom-right floating button
`;

const REQUIRED_FILE_STRUCTURE = `
### Required File Structure (use EXACTLY these paths)
- package.json (next, react, react-dom, tailwindcss, postcss, autoprefixer)
- tsconfig.json (Next.js standard)
- next.config.mjs (with images.remotePatterns for picsum.photos)
- tailwind.config.ts (with ALL custom colors, fonts, animations)
- postcss.config.js (CommonJS format with module.exports — NOT .mjs)
- src/app/layout.tsx (root layout with Inter font, metadata)
- src/app/page.tsx (home page composing all sections)
- src/app/globals.css (Tailwind directives + plain CSS custom classes — NO @apply in @layer blocks)
- src/types/index.ts (TypeScript interfaces)
- src/data/site.ts (brand config, nav links)
- src/data/products.ts (product data)
- src/data/articles.ts (editorial articles)
- src/data/archives.ts (archive gallery items)
- src/components/Header.tsx
- src/components/Hero.tsx
- src/components/FeaturedProducts.tsx
- src/components/Categories.tsx
- src/components/Editorial.tsx
- src/components/Archives.tsx
- src/components/About.tsx
- src/components/Footer.tsx
- src/components/BackToTop.tsx
`;

// ═════════════════════════════════════════════════════════════════════════════
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

  const MAX_API_RETRIES = 3;

  for (let apiAttempt = 1; apiAttempt <= MAX_API_RETRIES; apiAttempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
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

    // Handle rate limiting with exponential backoff
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const waitSec = retryAfter ? parseInt(retryAfter, 10) : 30 * apiAttempt;
      if (apiAttempt < MAX_API_RETRIES) {
        log("WARN", `Rate limited (429). Waiting ${waitSec}s before retry ${apiAttempt + 1}/${MAX_API_RETRIES}…`);
        await sleep(waitSec * 1000);
        continue;
      }
      const body = await res.text();
      throw new Error(`Rate limited after ${MAX_API_RETRIES} retries: ${body.slice(0, 500)}`);
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
      frontend: ["TypeScript", "Next.js", "Tailwind CSS", "React"],
      backend: [],
      devtools: [PM, "vitest"],
    },
  };
}

function mockSpec(): ProjectSpec {
  return {
    architecture: "Next.js 14 App Router with Tailwind CSS monochrome editorial design",
    fileStructure: [
      { filePath: "package.json", description: "Project manifest with Next.js + Tailwind" },
      { filePath: "tsconfig.json", description: "TypeScript config for Next.js" },
      { filePath: "next.config.mjs", description: "Next.js configuration" },
      { filePath: "tailwind.config.ts", description: "Tailwind with design system tokens" },
      { filePath: "postcss.config.mjs", description: "PostCSS config for Tailwind" },
      { filePath: "src/types/index.ts", description: "TypeScript interfaces" },
      { filePath: "src/data/site.ts", description: "Site config and navigation" },
      { filePath: "src/data/products.ts", description: "Product data" },
      { filePath: "src/data/articles.ts", description: "Editorial articles" },
      { filePath: "src/data/archives.ts", description: "Archive items" },
      { filePath: "src/app/globals.css", description: "Global styles with Tailwind" },
      { filePath: "src/app/layout.tsx", description: "Root layout with fonts" },
      { filePath: "src/app/page.tsx", description: "Home page" },
      { filePath: "src/components/Header.tsx", description: "Navigation header" },
      { filePath: "src/components/Hero.tsx", description: "Hero section" },
      { filePath: "src/components/FeaturedProducts.tsx", description: "Product grid" },
      { filePath: "src/components/Categories.tsx", description: "Category grid" },
      { filePath: "src/components/Editorial.tsx", description: "Editorial section" },
      { filePath: "src/components/Archives.tsx", description: "Archives gallery" },
      { filePath: "src/components/About.tsx", description: "About section" },
      { filePath: "src/components/Footer.tsx", description: "Footer" },
      { filePath: "src/components/BackToTop.tsx", description: "Back to top button" },
    ],
    apiEndpoints: [],
    buildScript: `${PM} run build`,
    testScript: `${PM} test`,
  };
}

function mockCodeGen(): GeneratedFile[] {
  return [
    {
      filePath: "package.json",
      content: JSON.stringify(
        {
          name: "generated-app",
          private: true,
          version: "1.0.0",
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "next lint",
          },
          dependencies: {
            next: "^14.2.0",
            react: "^18.3.0",
            "react-dom": "^18.3.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/node": "^20.0.0",
            "@types/react": "^18.3.0",
            "@types/react-dom": "^18.3.0",
            tailwindcss: "^3.4.0",
            postcss: "^8.4.0",
            autoprefixer: "^10.4.0",
          },
        },
        null,
        2
      ),
    },
    {
      filePath: "tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2017",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./src/*"] },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"],
        },
        null,
        2
      ),
    },
    {
      filePath: "next.config.mjs",
      content: [
        "/** @type {import('next').NextConfig} */",
        "const nextConfig = {",
        "  images: {",
        '    domains: ["picsum.photos"],',
        "  },",
        "};",
        "",
        "export default nextConfig;",
        "",
      ].join("\n"),
    },
    {
      filePath: "tailwind.config.ts",
      content: [
        'import type { Config } from "tailwindcss";',
        "",
        "const config: Config = {",
        '  content: ["./src/**/*.{ts,tsx}"],',
        "  theme: {",
        "    extend: {",
        "      colors: {",
        '        primary: { DEFAULT: "#0f172a", foreground: "#f8fafc" },',
        '        secondary: { DEFAULT: "#6366f1", foreground: "#ffffff" },',
        '        background: "#ffffff",',
        '        foreground: "#0f172a",',
        '        muted: { DEFAULT: "#f1f5f9", foreground: "#64748b" },',
        '        card: { DEFAULT: "#ffffff", foreground: "#0f172a" },',
        '        border: "#e2e8f0",',
        '        accent: { DEFAULT: "#6366f1", foreground: "#ffffff" },',
        '        destructive: "#ef4444",',
        "      },",
        "      fontFamily: {",
        '        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],',
        "      },",
        "      keyframes: {",
        '        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },',
        '        "slide-up": { from: { opacity: "0", transform: "translateY(20px)" }, to: { opacity: "1", transform: "translateY(0)" } },',
        "      },",
        "      animation: {",
        '        "fade-in": "fade-in 0.6s ease-out forwards",',
        '        "slide-up": "slide-up 0.6s ease-out forwards",',
        "      },",
        "    },",
        "  },",
        "  plugins: [],",
        "};",
        "",
        "export default config;",
        "",
      ].join("\n"),
    },
    {
      filePath: "postcss.config.js",
      content: [
        "module.exports = {",
        "  plugins: {",
        "    tailwindcss: {},",
        "    autoprefixer: {},",
        "  },",
        "};",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/types/index.ts",
      content: [
        "export interface Product {",
        "  id: string;",
        "  name: string;",
        "  price: number;",
        "  image: string;",
        "  alt: string;",
        "}",
        "",
        "export interface Category {",
        "  name: string;",
        "  image: string;",
        "  alt: string;",
        "}",
        "",
        "export interface Article {",
        "  category: string;",
        "  title: string;",
        "  image: string;",
        "  alt: string;",
        "}",
        "",
        "export interface ArchiveItem {",
        "  season: string;",
        "  title: string;",
        "  image: string;",
        "  alt: string;",
        "}",
        "",
        "export interface NavLink {",
        "  label: string;",
        "  href: string;",
        "}",
        "",
        "export interface SiteConfig {",
        "  brandName: string;",
        "  tagline: string;",
        "  description: string;",
        "  navLinks: NavLink[];",
        "  socialLinks: { label: string; href: string }[];",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/data/site.ts",
      content: [
        'import { SiteConfig } from "@/types";',
        "",
        "export const siteConfig: SiteConfig = {",
        '  brandName: "Premium Bikes",',
        '  tagline: "Ride the Difference",',
        '  description: "A curated collection of high-performance bicycles for every rider.",',
        "  navLinks: [",
        '    { label: "Home", href: "#home" },',
        '    { label: "Collection", href: "#products" },',
        '    { label: "Stories", href: "#editorial" },',
        '    { label: "About", href: "#about" },',
        "  ],",
        "  socialLinks: [",
        '    { label: "Instagram", href: "#" },',
        '    { label: "Twitter", href: "#" },',
        '    { label: "YouTube", href: "#" },',
        "  ],",
        "};",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/data/products.ts",
      content: [
        'import { Product } from "@/types";',
        "",
        "export const products: Product[] = [",
        '  { id: "1", name: "Mountain Explorer", price: 1299, image: "https://picsum.photos/600/800?random=1", alt: "Mountain bike on rocky trail" },',
        '  { id: "2", name: "City Cruiser", price: 899, image: "https://picsum.photos/600/800?random=2", alt: "Urban commuter bike" },',
        '  { id: "3", name: "Speed Racer", price: 2199, image: "https://picsum.photos/600/800?random=3", alt: "Aerodynamic road bike" },',
        '  { id: "4", name: "Trail Blazer", price: 1599, image: "https://picsum.photos/600/800?random=4", alt: "Full-suspension trail bike" },',
        "];",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/data/articles.ts",
      content: [
        'import { Article } from "@/types";',
        "",
        "export const articles: Article[] = [",
        '  { category: "Gear", title: "The Science Behind Carbon Frames", image: "https://picsum.photos/600/600?random=10", alt: "Carbon fiber close-up" },',
        '  { category: "Culture", title: "Urban Cycling Revolution", image: "https://picsum.photos/600/600?random=11", alt: "City cycling scene" },',
        '  { category: "Routes", title: "Epic Mountain Passes", image: "https://picsum.photos/600/600?random=12", alt: "Mountain pass road" },',
        "];",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/data/archives.ts",
      content: [
        'import { ArchiveItem } from "@/types";',
        "",
        "export const archives: ArchiveItem[] = [",
        '  { season: "Spring \'24", title: "Trail Season", image: "https://picsum.photos/600/600?random=20", alt: "Spring trail ride" },',
        '  { season: "Winter \'23", title: "Fat Bike Adventures", image: "https://picsum.photos/600/600?random=21", alt: "Snow biking" },',
        '  { season: "Fall \'23", title: "Gravel Grinding", image: "https://picsum.photos/600/600?random=22", alt: "Gravel path" },',
        '  { season: "Summer \'23", title: "Road Classics", image: "https://picsum.photos/600/600?random=23", alt: "Summer road race" },',
        '  { season: "Spring \'23", title: "MTB Opener", image: "https://picsum.photos/600/600?random=24", alt: "Mountain bike park" },',
        '  { season: "Winter \'22", title: "Indoor Training", image: "https://picsum.photos/600/600?random=25", alt: "Bike trainer setup" },',
        "];",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/app/globals.css",
      content: [
        "@tailwind base;",
        "@tailwind components;",
        "@tailwind utilities;",
        "",
        "/* Do NOT use @apply inside @layer — use plain CSS */",
        "* { border-color: #e2e8f0; }",
        "body {",
        "  background-color: #ffffff;",
        "  color: #0f172a;",
        "  font-family: var(--font-inter), Inter, system-ui, sans-serif;",
        "  -webkit-font-smoothing: antialiased;",
        "  -moz-osx-font-smoothing: grayscale;",
        "}",
        "html { scroll-behavior: smooth; }",
        "",
        ".glass {",
        "  background-color: rgba(255,255,255,0.8);",
        "  backdrop-filter: blur(24px);",
        "  -webkit-backdrop-filter: blur(24px);",
        "  border: 1px solid rgba(255,255,255,0.2);",
        "}",
        ".gradient-primary { background: linear-gradient(to bottom right, #0ea5e9, rgba(14,165,233,0.8)); }",
        ".text-balance { text-wrap: balance; }",
        ".animate-slide-up { animation: slide-up 0.6s ease-out forwards; }",
        ".btn-primary {",
        "  background-color: #0ea5e9;",
        "  color: #ffffff;",
        "  padding: 0.75rem 1.5rem;",
        "  border-radius: 0.5rem;",
        "  font-weight: 600;",
        "  transition: all 0.3s;",
        "}",
        ".btn-primary:hover { opacity: 0.9; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }",
        "",
        "@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }",
        "@keyframes slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/app/layout.tsx",
      content: [
        'import type { Metadata } from "next";',
        'import { Inter } from "next/font/google";',
        'import "./globals.css";',
        "",
        'const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });',
        "",
        "export const metadata: Metadata = {",
        '  title: "Premium Bikes",',
        '  description: "A curated collection of high-performance bicycles",',
        "};",
        "",
        "export default function RootLayout({ children }: { children: React.ReactNode }) {",
        "  return (",
        '    <html lang="en" className="scroll-smooth">',
        "      <body className={`${inter.variable} font-sans antialiased`}>{children}</body>",
        "    </html>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/app/page.tsx",
      content: [
        'import { Header } from "@/components/Header";',
        'import { Hero } from "@/components/Hero";',
        'import { FeaturedProducts } from "@/components/FeaturedProducts";',
        'import { Categories } from "@/components/Categories";',
        'import { Editorial } from "@/components/Editorial";',
        'import { Archives } from "@/components/Archives";',
        'import { About } from "@/components/About";',
        'import { Footer } from "@/components/Footer";',
        'import { BackToTop } from "@/components/BackToTop";',
        "",
        "export default function Home() {",
        "  return (",
        "    <>",
        "      <Header />",
        '      <main className="pt-16">',
        '        <section id="home">',
        "          <Hero />",
        "          <FeaturedProducts />",
        "          <Categories />",
        "        </section>",
        '        <Editorial id="editorial" />',
        '        <Archives id="archives" />',
        '        <About id="about" />',
        "      </main>",
        "      <Footer />",
        "      <BackToTop />",
        "    </>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/Header.tsx",
      content: [
        '"use client";',
        'import { siteConfig } from "@/data/site";',
        "",
        "export function Header() {",
        "  return (",
        '    <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-border px-4 md:px-10 lg:px-20 py-3">',
        '      <div className="flex items-center justify-between max-w-7xl mx-auto">',
        '        <h2 className="text-foreground text-lg font-bold tracking-tight">{siteConfig.brandName}</h2>',
        '        <div className="flex flex-1 justify-end gap-8">',
        '          <nav className="hidden md:flex items-center gap-9">',
        "            {siteConfig.navLinks.map((link) => (",
        '              <a key={link.href} href={link.href} className="text-muted-foreground text-sm font-medium hover:text-foreground transition-colors">{link.label}</a>',
        "            ))}",
        "          </nav>",
        '          <button className="gradient-primary flex min-w-[84px] cursor-pointer items-center justify-center rounded-lg px-4 h-10 text-primary-foreground text-sm font-bold">',
        "            Shop Now",
        "          </button>",
        "        </div>",
        "      </div>",
        "    </header>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/Hero.tsx",
      content: [
        "export function Hero() {",
        "  return (",
        '    <div className="w-full max-w-7xl mx-auto px-4 md:px-10 lg:px-20 py-10">',
        '      <div className="flex min-h-[600px] flex-col gap-6 bg-cover bg-center bg-no-repeat rounded-xl items-center justify-center p-8 shadow-xl"',
        '        style={{ backgroundImage: \'linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.7)), url("https://picsum.photos/1920/1080?random=0")\' }}>',
        '        <div className="flex flex-col gap-4 text-center max-w-2xl animate-slide-up">',
        '          <h1 className="text-white text-5xl md:text-7xl font-black leading-none tracking-tight">',
        "            Ride the Difference",
        "          </h1>",
        '          <p className="text-white/80 text-lg md:text-xl font-normal leading-relaxed text-balance">',
        "            Experience the intersection of performance and craftsmanship. A curated collection for the discerning cyclist.",
        "          </p>",
        "        </div>",
        '        <button className="gradient-primary flex min-w-[160px] cursor-pointer items-center justify-center rounded-lg px-6 h-14 text-primary-foreground text-base font-bold hover:shadow-lg transition-all duration-300">',
        "          Explore Collection",
        "        </button>",
        "      </div>",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/FeaturedProducts.tsx",
      content: [
        'import { products } from "@/data/products";',
        "",
        "export function FeaturedProducts() {",
        "  return (",
        '    <div className="w-full max-w-7xl mx-auto px-4 md:px-10 lg:px-20 mb-20">',
        '      <div className="flex items-end justify-between mb-10">',
        "        <div>",
        '          <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2 block">The Collection</span>',
        '          <h2 className="text-foreground text-4xl font-black tracking-tight">Featured Bikes</h2>',
        "        </div>",
        '        <a href="#" className="text-sm font-bold text-accent underline underline-offset-4 hover:text-accent/80 transition-colors">View All</a>',
        "      </div>",
        '      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">',
        "        {products.map((product) => (",
        '          <div key={product.id} className="group flex flex-col gap-4">',
        '            <div className="relative overflow-hidden aspect-[3/4] bg-muted rounded-xl transition-all duration-300 group-hover:shadow-xl">',
        '              <div className="w-full h-full bg-center bg-cover transition-transform duration-500 group-hover:scale-105"',
        "                style={{ backgroundImage: `url(\"${product.image}\")` }} />",
        "            </div>",
        "            <div>",
        '              <p className="text-foreground text-lg font-bold leading-tight">{product.name}</p>',
        '              <p className="text-muted-foreground text-sm font-medium">${product.price.toLocaleString()}</p>',
        "            </div>",
        "          </div>",
        "        ))}",
        "      </div>",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/Categories.tsx",
      content: [
        "const categories = [",
        '  { name: "Mountain", image: "https://picsum.photos/400/300?random=5" },',
        '  { name: "Road", image: "https://picsum.photos/400/300?random=6" },',
        '  { name: "Urban", image: "https://picsum.photos/400/300?random=7" },',
        '  { name: "Accessories", image: "https://picsum.photos/400/300?random=8" },',
        "];",
        "",
        "export function Categories() {",
        "  return (",
        '    <div className="w-full max-w-7xl mx-auto px-4 md:px-10 lg:px-20 mb-20">',
        '      <h2 className="text-foreground text-3xl font-black tracking-tight mb-8">Categories</h2>',
        '      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">',
        "        {categories.map((cat) => (",
        '          <div key={cat.name} className="relative h-48 group cursor-pointer overflow-hidden rounded-xl">',
        '            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent group-hover:from-black/70 transition-colors z-10" />',
        '            <div className="w-full h-full bg-center bg-cover group-hover:scale-110 transition-transform duration-500"',
        "              style={{ backgroundImage: `url(\"${cat.image}\")` }} />",
        '            <div className="absolute inset-0 flex items-end p-4 z-20">',
        '              <span className="text-white font-bold text-lg">{cat.name}</span>',
        "            </div>",
        "          </div>",
        "        ))}",
        "      </div>",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/Editorial.tsx",
      content: [
        'import { articles } from "@/data/articles";',
        "",
        "export function Editorial({ id }: { id?: string }) {",
        "  return (",
        '    <section className="bg-muted py-16 md:py-24 lg:py-32" id={id}>',
        '      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">',
        '        <div className="flex flex-col md:flex-row gap-16 md:gap-20 mb-24">',
        '          <div className="flex-1">',
        '            <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-4 block">Current Issue</span>',
        '            <h2 className="text-foreground text-5xl md:text-6xl font-black leading-tight tracking-tight mb-8">The Art of the Ride</h2>',
        '            <p className="text-lg text-muted-foreground font-normal leading-relaxed max-w-md text-balance">',
        "              Exploring the boundary between machine and movement. This season, we look at what makes a great bike timeless.",
        "            </p>",
        '            <div className="mt-12">',
        '              <button className="gradient-primary text-primary-foreground px-8 py-4 font-bold text-sm uppercase tracking-widest rounded-lg hover:shadow-lg transition-all duration-300">Read Feature</button>',
        "            </div>",
        "          </div>",
        '          <div className="flex-1">',
        '            <div className="aspect-[4/5] bg-muted rounded-xl shadow-xl overflow-hidden">',
        '              <div className="w-full h-full bg-center bg-cover"',
        '                style={{ backgroundImage: \'url("https://picsum.photos/800/1000?random=9")\' }} />',
        "            </div>",
        "          </div>",
        "        </div>",
        '        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">',
        "          {articles.map((article) => (",
        '            <div key={article.title} className="group cursor-pointer">',
        '              <div className="aspect-square bg-muted mb-6 overflow-hidden rounded-xl">',
        '                <div className="w-full h-full bg-center bg-cover group-hover:scale-105 transition-transform duration-500"',
        "                  style={{ backgroundImage: `url(\"${article.image}\")` }} />",
        "              </div>",
        '              <span className="text-xs font-bold text-accent uppercase tracking-widest">{article.category}</span>',
        '              <h3 className="text-xl font-bold mt-2 group-hover:underline">{article.title}</h3>',
        "            </div>",
        "          ))}",
        "        </div>",
        "      </div>",
        "    </section>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/Archives.tsx",
      content: [
        'import { archives } from "@/data/archives";',
        "",
        "export function Archives({ id }: { id?: string }) {",
        "  return (",
        '    <section className="py-16 md:py-24 lg:py-32 bg-background" id={id}>',
        '      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">',
        '        <div className="mb-16 border-b border-border pb-8">',
        '          <h2 className="text-foreground text-4xl md:text-5xl font-black tracking-tight">Archives</h2>',
        "        </div>",
        '        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">',
        "          {archives.map((item) => (",
        '            <div key={item.title} className="aspect-square relative group overflow-hidden rounded-xl">',
        '              <div className="w-full h-full bg-center bg-cover"',
        "                style={{ backgroundImage: `url(\"${item.image}\")` }} />",
        '              <div className="absolute inset-0 bg-primary/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6">',
        '                <p className="text-primary-foreground text-xs font-bold uppercase tracking-widest">{item.season}</p>',
        '                <h4 className="text-primary-foreground font-bold text-lg">{item.title}</h4>',
        "              </div>",
        "            </div>",
        "          ))}",
        "        </div>",
        '        <div className="mt-16 flex justify-center">',
        '          <button className="border border-border px-10 py-4 text-sm font-bold uppercase tracking-widest rounded-lg hover:bg-primary hover:text-primary-foreground transition-all duration-300">Load More</button>',
        "        </div>",
        "      </div>",
        "    </section>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/About.tsx",
      content: [
        'import { siteConfig } from "@/data/site";',
        "",
        "export function About({ id }: { id?: string }) {",
        "  return (",
        '    <section className="py-16 md:py-24 lg:py-32 bg-muted overflow-hidden" id={id}>',
        '      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">',
        '        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">',
        '          <div className="aspect-square w-full bg-muted rounded-xl overflow-hidden shadow-xl">',
        '            <div className="w-full h-full bg-center bg-cover"',
        '              style={{ backgroundImage: \'url("https://picsum.photos/800/800?random=30")\' }} />',
        "          </div>",
        "          <div>",
        '            <span className="text-xs font-bold tracking-widest uppercase text-accent mb-4 block">Our Story</span>',
        '            <h2 className="text-foreground text-4xl md:text-5xl font-black leading-tight tracking-tight mb-8">Built for Those Who Ride.</h2>',
        '            <div className="space-y-6 text-lg text-muted-foreground leading-relaxed">',
        "              <p>{siteConfig.description}</p>",
        '              <p>Every bike we curate reflects our commitment to performance, durability, and the pure joy of cycling.</p>',
        "            </div>",
        '            <div className="mt-12 grid grid-cols-2 gap-8">',
        '              <div><h4 className="text-3xl font-black text-accent mb-1">500+</h4><p className="text-sm text-muted-foreground">Bikes curated</p></div>',
        '              <div><h4 className="text-3xl font-black text-accent mb-1">10k+</h4><p className="text-sm text-muted-foreground">Happy riders</p></div>',
        "            </div>",
        "          </div>",
        "        </div>",
        "      </div>",
        "    </section>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/Footer.tsx",
      content: [
        'import { siteConfig } from "@/data/site";',
        "",
        "export function Footer() {",
        "  return (",
        '    <footer className="gradient-primary text-primary-foreground py-16 md:py-20">',
        '      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">',
        '        <div className="flex flex-col md:flex-row justify-between gap-16 mb-20">',
        '          <div className="max-w-xs">',
        '            <h2 className="text-xl font-bold mb-6">{siteConfig.brandName}</h2>',
        '            <p className="text-primary-foreground/60 text-sm leading-relaxed">{siteConfig.description}</p>',
        "          </div>",
        '          <div className="grid grid-cols-2 md:grid-cols-3 gap-12">',
        '            <div className="flex flex-col gap-4">',
        '              <h5 className="text-xs font-bold uppercase tracking-widest text-primary-foreground/40">Navigation</h5>',
        "              {siteConfig.navLinks.map((link) => (",
        '                <a key={link.href} href={link.href} className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">{link.label}</a>',
        "              ))}",
        "            </div>",
        '            <div className="flex flex-col gap-4">',
        '              <h5 className="text-xs font-bold uppercase tracking-widest text-primary-foreground/40">Connect</h5>',
        "              {siteConfig.socialLinks.map((link) => (",
        '                <a key={link.label} href={link.href} className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">{link.label}</a>',
        "              ))}",
        "            </div>",
        '            <div className="flex flex-col gap-6">',
        '              <h5 className="text-xs font-bold uppercase tracking-widest text-primary-foreground/40">Newsletter</h5>',
        '              <input className="bg-primary-foreground/10 border border-primary-foreground/20 text-primary-foreground text-sm py-3 px-4 rounded-lg placeholder:text-primary-foreground/40" placeholder="Email address" type="email" />',
        '              <button className="bg-primary-foreground text-primary text-xs font-bold uppercase py-3 tracking-widest rounded-lg hover:bg-primary-foreground/90 transition-colors">Subscribe</button>',
        "            </div>",
        "          </div>",
        "        </div>",
        '        <div className="pt-8 border-t border-primary-foreground/10 flex flex-col md:flex-row justify-between items-center">',
        '          <p className="text-primary-foreground/30 text-xs uppercase tracking-widest">&copy; 2024 {siteConfig.brandName}. All Rights Reserved.</p>',
        '          <div className="flex gap-6 mt-4 md:mt-0">',
        '            <a href="#" className="text-primary-foreground/30 text-xs uppercase tracking-widest hover:text-primary-foreground transition-colors">Privacy</a>',
        '            <a href="#" className="text-primary-foreground/30 text-xs uppercase tracking-widest hover:text-primary-foreground transition-colors">Terms</a>',
        "          </div>",
        "        </div>",
        "      </div>",
        "    </footer>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/components/BackToTop.tsx",
      content: [
        '"use client";',
        "",
        "export function BackToTop() {",
        "  return (",
        '    <a href="#home" className="fixed bottom-8 right-8 size-12 gradient-primary text-primary-foreground flex items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110 active:scale-95 z-40">',
        "      <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"m18 15-6-6-6 6\"/></svg>",
        "    </a>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
  ];
}

function mockBuildFix(): BuildFixResponse {
  return {
    fixes: [
      {
        filePath: "next.config.mjs",
        content: [
          "/** @type {import('next').NextConfig} */",
          "const nextConfig = {",
          "  images: {",
          '    domains: ["picsum.photos"],',
          "  },",
          "};",
          "",
          "export default nextConfig;",
          "",
        ].join("\n"),
      },
    ],
    explanation: "Fixed Next.js config to allow image domains",
  };
}

function mockCommitMsg(): CommitMessageResponse {
  return {
    message: "feat: initial Next.js project with editorial landing page layout",
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
    "frontend": ["TypeScript", "Next.js", "Tailwind CSS", "React"],
    "backend": [],
    "devtools": ["${PM}", "vitest"]
  }
}

The project uses Next.js (App Router) with Tailwind CSS and a monochrome editorial design system.
Map the idea into 6–8 features matching these page sections: Hero, Featured Products, Categories, Editorial/Blog, Archives/Gallery, About, Contact/Newsletter.
List 6–8 features. Always use Next.js + Tailwind CSS as the tech stack.`;

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
Create a detailed project specification for a Next.js App Router project.

Analysis:
${JSON.stringify(ctx.analysis, null, 2)}

${DESIGN_SYSTEM}

Respond with JSON:
{
  "architecture": "Next.js 14 App Router with Tailwind CSS — creative modern design",
  "fileStructure": [
    { "filePath": "relative/path/file.ts", "description": "Purpose" }
  ],
  "apiEndpoints": [],
  "buildScript": "${PM} run build",
  "testScript": "${PM} test"
}

${REQUIRED_FILE_STRUCTURE}

Do NOT include test files — tests will be handled separately.
Do NOT include any Vite-related files.`;

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

    // Sort: types → data → config → components → tests (ensures type defs exist before components)
    const priorityOrder = (fp: string): number => {
      if (fp.includes("types/")) return 0;
      if (fp.includes("data/")) return 1;
      if (fp.endsWith("package.json") || fp.endsWith("tsconfig.json") || fp.endsWith("next.config.mjs") || fp.endsWith("tailwind.config.ts") || fp.endsWith("postcss.config.js") || fp.endsWith("postcss.config.mjs")) return 2;
      if (fp.endsWith("index.html") || fp.includes("main.ts") || fp.includes("App.ts")) return 3;
      if (fp.includes("hooks/") || fp.includes("utils/") || fp.includes("ui/")) return 4;
      if (fp.includes("components/")) return 5;
      if (fp.includes("styles/")) return 6;
      if (fp.includes("__tests__/") || fp.includes(".test.")) return 7;
      return 5;
    };
    const allPlanned = [...spec.fileStructure].sort((a, b) => priorityOrder(a.filePath) - priorityOrder(b.filePath));
    const BATCH_SIZE = 4;
    const allFiles: GeneratedFile[] = [];

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
Generate beautiful, production-quality Next.js 14 App Router code for a landing page.

BE CREATIVE with the visual design — make it stunning, modern, and unique.
The design should feel premium and polished, with thoughtful use of color, typography, and spacing.

Project: ${ctx.analysis?.projectName}
User's idea: "${ctx.idea}"
Full project file list: ${allPlanned.map((f) => f.filePath).join(", ")}

${DESIGN_SYSTEM}
${existingContext}
Generate ONLY these files (batch ${batchIdx + 1}/${batches.length}):
${fileList}

Respond with a JSON array:
[
  { "filePath": "<exact path>", "content": "<full file content>" }
]

CRITICAL rules (violating these causes build failures):
- Next.js 14 App Router — use "use client" for components with interactivity (onClick, useState, useEffect)
- Use next/font/google for Inter font in layout.tsx: const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
- next.config.mjs must use remotePatterns (not domains) for picsum.photos:
  images: { remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }] }
- tailwind.config.ts MUST define ALL custom color tokens in theme.extend.colors
- globals.css MUST have @tailwind base; @tailwind components; @tailwind utilities; + @layer base with body styles
- postcss.config.js MUST use CommonJS (module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } })
- package.json scripts: { "dev": "next dev", "build": "next build", "start": "next start" }
- Every file must be COMPLETE — no TODOs, no placeholders, no "..." shortcuts
- Data files must export typed arrays matching interfaces in types/index.ts
- IMPORT/EXPORT CONSISTENCY: If a component imports { foo, bar } from "@/data/xyz", then "@/data/xyz" MUST export both foo and bar. Check previously generated data files (shown in context above) and ONLY import symbols that actually exist. If you need new data, ADD exports to the data file in this batch.
- Do NOT use React.FC — use plain function components with typed props
- For images: use div with bg-cover bg-center + inline style backgroundImage with picsum.photos URLs
- Do NOT use Next.js <Image> component — use div backgrounds for reliable styling
- Do NOT import React explicitly (Next.js auto-imports it)
- tsconfig.json must include paths: { "@/*": ["./src/*"] }
- Return ONLY the ${batch.length} file(s) listed above`;

      log("INFO", `Batch ${batchIdx + 1}/${batches.length}: generating ${batch.map((f) => f.filePath).join(", ")}`);

      const batchFiles = (await callLLM(prompt, 32000)) as GeneratedFile[];
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
 * Start the Next.js dev server, fetch key pages, capture runtime errors.
 * Returns errors found in server output or HTTP 500 responses.
 */
async function runtimeCheck(projectDir: string): Promise<RuntimeCheckResult> {
  const PORT = 3457;
  const errors: string[] = [];
  let serverOutput = "";
  let serverReady = false;

  const proc = spawn(PM, ["run", "dev"], {
    cwd: projectDir,
    stdio: "pipe",
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "development" },
  });

  proc.stdout?.on("data", (d: Buffer) => { serverOutput += d.toString(); });
  proc.stderr?.on("data", (d: Buffer) => { serverOutput += d.toString(); });

  // Wait for server to be ready (max 30s)
  const startTime = Date.now();
  while (Date.now() - startTime < 30_000) {
    if (serverOutput.includes("Ready") || serverOutput.includes("ready on") || serverOutput.includes("started server")) {
      serverReady = true;
      break;
    }
    await sleep(1000);
  }

  if (!serverReady) {
    proc.kill("SIGTERM");
    return { success: false, errors: ["Dev server failed to start within 30s"], serverOutput };
  }

  await sleep(2000);

  // Discover static pages to test
  const pagesToTest = ["/"];
  try {
    const appDir = path.join(projectDir, "src", "app");
    const entries = await fs.readdir(appDir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith("[") && !entry.name.startsWith("_")) {
        const parentPath = (entry as Dirent & { parentPath?: string }).parentPath ?? appDir;
        const relPath = path.relative(appDir, path.join(parentPath, entry.name));
        if (relPath && relPath !== "." && !relPath.includes("[")) {
          pagesToTest.push("/" + relPath.replace(/\\/g, "/"));
        }
      }
    }
  } catch { /* just test homepage */ }

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

  // Scan full server output for uncaught errors
  const runtimePatterns = [
    /⨯\s+(src\/[^\n]+)/g,
    /TypeError:\s+([^\n]+)/g,
    /ReferenceError:\s+([^\n]+)/g,
    /Error:\s+Cannot read properties of (undefined|null)[^\n]*/g,
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
  return { success: errors.length === 0, errors, serverOutput };
}

// ═════════════════════════════════════════════════════════════════════════════
//  AGENT 4 — BUILD & AUTO-FIX (retry loop, max 5 attempts)
// ═════════════════════════════════════════════════════════════════════════════

async function buildAndFixAgent(ctx: SharedContext): Promise<AgentResult<string>> {
  const MAX_RETRIES = 5;
  const ws = ctx.workspacePath;

  // Step 1: install dependencies
  log("INFO", `Installing dependencies with ${PM}…`);
  const install = execSafe(`${PM} install`, ws);
  if (!install.success) {
    ctx.buildLogs.push(install.stdout);
    return { success: false, data: "", error: `${PM} install failed:\n${install.stdout}` };
  }
  log("INFO", "Dependencies installed");

  // Step 2: build + runtime check with retries
  const RUNTIME_MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log("INFO", `Build attempt ${attempt}/${MAX_RETRIES}…`);
    const build = execSafe(`${PM} run build`, ws);
    ctx.buildLogs.push(build.stdout);

    if (build.success) {
      log("INFO", "Build succeeded — running runtime check…");

      // Step 3: runtime check — start dev server and fetch pages
      let runtimeOk = false;
      for (let rtAttempt = 1; rtAttempt <= RUNTIME_MAX_RETRIES; rtAttempt++) {
        log("INFO", `Runtime check attempt ${rtAttempt}/${RUNTIME_MAX_RETRIES}…`);
        const rt = await runtimeCheck(ws);

        if (rt.success) {
          log("INFO", "Runtime check passed — all pages render without errors");
          runtimeOk = true;
          break;
        }

        log("WARN", `Runtime errors found (attempt ${rtAttempt}):`, { errors: rt.errors.slice(0, 3) });

        if (rtAttempt === RUNTIME_MAX_RETRIES) {
          log("WARN", `Runtime check failed after ${RUNTIME_MAX_RETRIES} attempts — proceeding anyway`);
          // Don't block the pipeline, just warn — user can fix via interactive review
          break;
        }

        // Send runtime errors to LLM for fix
        log("INFO", "Requesting runtime fix from LLM…");

        // Gather files mentioned in errors
        const errorFileMatches = rt.errors.join("\n").match(/src\/[^\s:(]+/g) ?? [];
        const errorFiles = [...new Set(errorFileMatches)];

        const allFiles = await listFilesSafe(ws);
        const sourceFiles: { path: string; content: string }[] = [];
        const added = new Set<string>();

        for (const fp of allFiles) {
          if (fp.startsWith("node_modules") || fp.startsWith(".next")) continue;
          const isErrorFile = errorFiles.some((ef) => fp.includes(ef) || ef.includes(fp));
          const isDataFile = fp.includes("/data/") && (fp.endsWith(".ts") || fp.endsWith(".tsx"));
          const isTypeFile = fp.includes("/types/") && (fp.endsWith(".ts") || fp.endsWith(".tsx"));

          if ((isErrorFile || isDataFile || isTypeFile) && !added.has(fp)) {
            added.add(fp);
            sourceFiles.push({ path: fp, content: await readFileSafe(ws, fp) });
          }
        }

        const rtFixPrompt = `[FIX_RUNTIME_ERROR]
The Next.js project builds successfully but crashes at runtime when pages are loaded.

Runtime errors:
${rt.errors.map((e, i) => `${i + 1}. ${e}`).join("\n\n")}

Relevant source files:
${JSON.stringify(sourceFiles, null, 2)}

Common causes:
- Accessing properties of undefined (e.g., array[index] where index is out of bounds)
- Using data before it's loaded or initialized
- Missing null/undefined checks for optional data
- Type mismatch between data files and component usage
- Calling .map() on undefined arrays

RULES:
- Fix the root cause, don't just add try/catch
- Ensure all data arrays are initialized
- Add proper null checks where data might be undefined
- Make sure component props match the data shape

Respond with JSON:
{
  "fixes": [
    { "filePath": "path/to/file", "content": "complete corrected content" }
  ],
  "explanation": "What was wrong and how it was fixed"
}`;

        const rtFix = (await callLLM(rtFixPrompt)) as BuildFixResponse;
        log("INFO", `Runtime fix: ${rtFix.explanation}`);

        for (const f of rtFix.fixes) {
          await writeFileSafe(ws, f.filePath, f.content);
        }

        // Rebuild after runtime fix
        log("INFO", "Rebuilding after runtime fix…");
        const rebuild = execSafe(`${PM} run build`, ws);
        if (!rebuild.success) {
          log("WARN", "Rebuild failed after runtime fix — will retry from build loop");
          break; // Go back to outer build loop
        }

        if (rtAttempt < RUNTIME_MAX_RETRIES) {
          log("INFO", "Waiting 10s before next runtime check…");
          await sleep(10_000);
        }
      }

      return { success: true, data: build.stdout };
    }

    log("WARN", `Build failed (attempt ${attempt})`, { output: build.stdout.slice(0, 500) });

    if (attempt === MAX_RETRIES) {
      return {
        success: false,
        data: "",
        error: `Build failed after ${MAX_RETRIES} attempts:\n${build.stdout}`,
      };
    }

    // Ask LLM to fix — send relevant files + import targets to reduce token usage
    log("INFO", "Requesting build fix from LLM…");

    // Extract file paths mentioned in error output
    const errorFileMatches = build.stdout.match(/src\/[^\s:(]+/g) ?? [];
    const errorFilePaths = [...new Set(errorFileMatches)];

    // Also extract import targets from error messages (e.g., "is not exported from '@/data/site'")
    const importTargetMatches = build.stdout.match(/'@\/([^']+)'/g) ?? [];
    const importTargetPaths = importTargetMatches.map((m) => "src/" + m.replace(/@\//g, "").replace(/'/g, ""));

    const allFiles = await listFilesSafe(ws);
    const sourceFiles: { path: string; content: string }[] = [];
    const added = new Set<string>();

    const addFile = async (fp: string) => {
      if (added.has(fp)) return;
      added.add(fp);
      const content = await readFileSafe(ws, fp);
      sourceFiles.push({ path: fp, content });
    };

    for (const fp of allFiles) {
      if (fp.startsWith("node_modules")) continue;

      // Always include config files
      const isConfig = fp.endsWith("package.json") || fp.endsWith("tsconfig.json") || fp.endsWith("next.config.mjs") || fp.endsWith("tailwind.config.ts") || fp.endsWith("postcss.config.js");
      // Include files mentioned in errors
      const isErrorFile = errorFilePaths.some((ef) => fp.includes(ef) || ef.includes(fp));
      // Include import target modules (e.g., @/data/site → src/data/site.ts)
      const isImportTarget = importTargetPaths.some((it) => fp.startsWith(it));
      // Always include all data files (common source of missing exports)
      const isDataFile = fp.includes("/data/") && (fp.endsWith(".ts") || fp.endsWith(".tsx"));

      if (isConfig || isErrorFile || isImportTarget || isDataFile) {
        await addFile(fp);
      }
    }

    // If still too few files, include all src non-test files
    if (sourceFiles.length <= 3) {
      for (const fp of allFiles) {
        if (fp.startsWith("node_modules")) continue;
        if (fp.includes("__tests__")) continue;
        if (added.has(fp)) continue;
        if (fp.endsWith(".ts") || fp.endsWith(".tsx") || fp.endsWith(".json") || fp.endsWith(".html") || fp.endsWith(".css")) {
          await addFile(fp);
        }
      }
    }

    // Detect import/export mismatch pattern
    const isImportMismatch = /is not exported from|has no exported member|cannot find module/i.test(build.stdout);

    const fixPrompt = `[FIX_BUILD]
The following project has a build error. Analyze and provide fixed file contents.

Build command: ${PM} run build
Error output:
${build.stdout}

${isImportMismatch ? `IMPORTANT: This is an IMPORT/EXPORT MISMATCH error.
- Check what the component is trying to import (the symbol name)
- Check what the data/module file actually exports
- Fix by ADDING the missing exports to the data file with appropriate content
- Do NOT just remove imports — the component needs that data to render
- Make sure the exported data shape matches how it's used in the component
` : ""}
Project files:
${JSON.stringify(sourceFiles, null, 2)}

Respond with JSON:
{
  "fixes": [
    { "filePath": "path/to/file", "content": "complete corrected content" }
  ],
  "explanation": "What was wrong and how it was fixed"
}`;

    const fix = (await callLLM(fixPrompt)) as BuildFixResponse;
    log("INFO", `LLM fix: ${fix.explanation}`);

    for (const f of fix.fixes) {
      await writeFileSafe(ws, f.filePath, f.content);
    }

    // Wait before next build attempt to avoid rate limits
    if (attempt < MAX_RETRIES) {
      log("INFO", "Waiting 15s before next build attempt (rate limit cooldown)…");
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
    log("INFO", "Running tests…");
    const result = execSafe(`${PM} test`, ctx.workspacePath);
    ctx.testLogs.push(result.stdout);

    if (result.success) {
      log("INFO", "All tests passed");
      return { success: true, data: result.stdout };
    }

    log("WARN", "Some tests failed");
    return { success: false, data: result.stdout, error: `Tests failed:\n${result.stdout}` };
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
        ext === ".tsx" || ext === ".ts"
          ? "📄"
          : ext === ".css"
            ? "🎨"
            : ext === ".json"
              ? "⚙️"
              : ext === ".html"
                ? "🌐"
                : "📄";
      lines.push(`${prefix}${icon} ${parts[parts.length - 1]}  — ${f.description}`);
    }
    return lines.join("\n");
  };

  // Build component diagram (ASCII)
  const componentNames = s.fileStructure
    .filter((f) => f.filePath.includes("components/"))
    .map((f) => path.basename(f.filePath, path.extname(f.filePath)));

  const diagram = [
    "```",
    "┌─────────────────────────────────────────────┐",
    "│                  App (layout.tsx)            │",
    "│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │",
    ...componentNames.map(
      (name) => `│  │ ${name.padEnd(8).slice(0, 8)} │                              │`
    ),
    "│  └──────────┘ └──────────┘ └──────────┘     │",
    "│                                             │",
    "│  Data: src/data/ ──→ Components ──→ Pages   │",
    "│  Types: src/types/ ──→ Data + Components    │",
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
  log("INFO", "Starting dev server (next dev)…");
  devServerProcess = spawn(PM, ["run", "dev"], {
    cwd: projectDir,
    stdio: "pipe",
    env: { ...process.env, PORT: "3456" },
  });

  devServerProcess.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line.includes("Ready") || line.includes("localhost") || line.includes("ready")) {
      log("INFO", `Dev server: ${line}`);
    }
  });
  devServerProcess.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line && !line.includes("ExperimentalWarning")) {
      log("DEBUG", `Dev server stderr: ${line}`);
    }
  });

  // Give it time to start
  log("INFO", "Dev server starting on http://localhost:3456 …");
}

function stopDevServer(): void {
  if (devServerProcess) {
    devServerProcess.kill("SIGTERM");
    devServerProcess = null;
    log("INFO", "Dev server stopped");
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
        '    "change the tech stack to use Vue instead of React"',
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
  "buildScript": "${PM} run build",
  "testScript": "${PM} test"
}

Apply the user's requested changes while keeping all other fields intact.
Remember: Next.js App Router with src/app/, src/components/, src/data/, src/types/ structure.`;

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
    if (fp.endsWith(".md")) continue;
    if (/\.(ts|tsx|css|json|js|mjs|html)$/.test(fp)) {
      const content = await readFileSafe(ctx.workspacePath, fp);
      sourceFiles.push({ path: fp, content });
    }
  }

  const prompt = `[APPLY_CHANGE]
The user is reviewing their website and wants changes made.

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
- Maintain all existing imports and exports
- Keep the existing design system and color tokens
- If the user asks about style changes, modify the relevant component's Tailwind classes or globals.css
- If the user asks about content changes, modify the data files or component text
- postcss.config.js must stay CommonJS
- Do NOT break existing imports/exports`;

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
      // Install deps if node_modules doesn't exist yet (codegen runs before build)
      const nodeModulesExist = existsSync(path.join(ctx.workspacePath, "node_modules"));
      if (!nodeModulesExist) {
        log("INFO", `Installing dependencies with ${PM} for preview…`);
        const installResult = execSafe(`${PM} install`, ctx.workspacePath);
        if (!installResult.success) {
          log("WARN", "Could not install deps for preview — server may not start");
        }
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
          const fileMatches = err.matchAll(/(src\/[^\s:]+\.[a-z]+)/g);
          for (const m of fileMatches) brokenFiles.add(m[1]);
        }

        // Always include data files (common source of runtime "undefined" errors)
        try {
          const dataDir = path.join(ctx.workspacePath, "src", "data");
          const dataFiles = await fs.readdir(dataDir).catch(() => [] as string[]);
          for (const f of dataFiles) {
            if (f.endsWith(".ts") || f.endsWith(".tsx")) brokenFiles.add(`src/data/${f}`);
          }
        } catch { /* no data dir */ }

        // Also include types
        try {
          const typesDir = path.join(ctx.workspacePath, "src", "types");
          const typeFiles = await fs.readdir(typesDir).catch(() => [] as string[]);
          for (const f of typeFiles) {
            if (f.endsWith(".ts")) brokenFiles.add(`src/types/${f}`);
          }
        } catch { /* no types dir */ }

        // Read file contents
        const fileContents: string[] = [];
        for (const relPath of brokenFiles) {
          try {
            const content = await fs.readFile(path.join(ctx.workspacePath, relPath), "utf-8");
            fileContents.push(`=== ${relPath} ===\n${content}`);
          } catch { /* skip unreadable */ }
        }

        const fixPrompt = `You are fixing RUNTIME errors in a Next.js 14 (App Router) + TypeScript project.

RUNTIME ERRORS:
${rtResult.errors.join("\n\n")}

RELEVANT SERVER OUTPUT:
${(rtResult.serverOutput ?? "").slice(-3000)}

SOURCE FILES:
${fileContents.join("\n\n")}

COMMON RUNTIME ERROR PATTERNS:
- "Cannot read properties of undefined (reading 'map')" → data is undefined, add fallback: (data ?? []).map(...)
- "Cannot read properties of undefined (reading '0')" → array access on undefined, add optional chaining: arr?.[0]
- Import exists but export doesn't → add the missing export to the data/types file
- Component uses properties that don't exist on the data type → fix property names to match actual data

Return a JSON object with:
{
  "explanation": "what you fixed and why",
  "files": [
    { "path": "src/components/Categories.tsx", "content": "...full corrected file content..." }
  ]
}

RULES:
- Fix ALL runtime errors, not just the first one
- Add defensive checks: optional chaining (?.), nullish coalescing (??), default empty arrays
- Ensure every import references an actually exported symbol
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
      await sleep(5000); // Give Next.js dev server time to compile
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
                  const rebuild = execSafe(`${PM} run build`, ctx.workspacePath);
                  if (rebuild.success) {
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
          }
          break;

        case "quit":
          reviewing = false;
          stopDevServer();
          // Save checkpoint so user can resume later
          await saveCheckpoint(ctx, agentIdx > 0 ? agentIdx - 1 : -1, completedAgents);
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
