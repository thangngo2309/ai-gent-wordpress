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
import { Dirent } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { execSync } from "node:child_process";

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

interface AgentStep {
  name: string;
  description: string;
  run: (ctx: SharedContext) => Promise<AgentResult>;
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

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground font-sans antialiased; }
}

@layer components {
  .glass { @apply bg-white/80 backdrop-blur-xl border border-white/20; }
  .gradient-primary { @apply bg-gradient-to-br from-primary to-primary/80; }
  .text-balance { text-wrap: balance; }
  .animate-in { animation: fade-in 0.6s ease-out forwards; }
}
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
- postcss.config.mjs
- src/app/layout.tsx (root layout with Inter font, metadata)
- src/app/page.tsx (home page composing all sections)
- src/app/globals.css (Tailwind directives + custom layers)
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
      filePath: "postcss.config.mjs",
      content: [
        "/** @type {import('postcss-load-config').Config} */",
        "const config = {",
        "  plugins: {",
        "    tailwindcss: {},",
        "    autoprefixer: {},",
        "  },",
        "};",
        "",
        "export default config;",
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
        "@layer base {",
        "  * { @apply border-border; }",
        "  body { @apply bg-background text-foreground font-sans antialiased; }",
        "}",
        "",
        "@layer components {",
        "  .glass { @apply bg-white/80 backdrop-blur-xl border border-white/20; }",
        "  .gradient-primary { @apply bg-gradient-to-br from-primary to-primary/80; }",
        "  .text-balance { text-wrap: balance; }",
        "}",
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
      if (fp.endsWith("package.json") || fp.endsWith("tsconfig.json") || fp.endsWith("next.config.mjs") || fp.endsWith("tailwind.config.ts") || fp.endsWith("postcss.config.mjs")) return 2;
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
- package.json scripts: { "dev": "next dev", "build": "next build", "start": "next start" }
- Every file must be COMPLETE — no TODOs, no placeholders, no "..." shortcuts
- Data files must export typed arrays matching interfaces in types/index.ts
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

  // Step 2: build with retries
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log("INFO", `Build attempt ${attempt}/${MAX_RETRIES}…`);
    const build = execSafe(`${PM} run build`, ws);
    ctx.buildLogs.push(build.stdout);

    if (build.success) {
      log("INFO", "Build succeeded");
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

    // Ask LLM to fix — only send relevant files to reduce token usage
    log("INFO", "Requesting build fix from LLM…");

    // Extract file paths mentioned in error output
    const errorFileMatches = build.stdout.match(/src\/[^\s:(]+/g) ?? [];
    const errorFilePaths = [...new Set(errorFileMatches)];

    const allFiles = await listFilesSafe(ws);
    const sourceFiles: { path: string; content: string }[] = [];
    for (const fp of allFiles) {
      if (fp.startsWith("node_modules")) continue;
      // Always include config files, only include src files mentioned in errors
      const isConfig = fp.endsWith("package.json") || fp.endsWith("tsconfig.json") || fp.endsWith("next.config.mjs") || fp.endsWith("tailwind.config.ts");
      const isErrorFile = errorFilePaths.some((ef) => fp.includes(ef) || ef.includes(fp));
      if (isConfig || isErrorFile) {
        const content = await readFileSafe(ws, fp);
        sourceFiles.push({ path: fp, content });
      }
    }

    // If no specific files found from errors, fall back to all non-test src files (limited)
    if (sourceFiles.length <= 3) {
      for (const fp of allFiles) {
        if (fp.startsWith("node_modules")) continue;
        if (fp.includes("__tests__")) continue;
        if (sourceFiles.some((s) => s.path === fp)) continue;
        if (fp.endsWith(".ts") || fp.endsWith(".tsx") || fp.endsWith(".json") || fp.endsWith(".html") || fp.endsWith(".css")) {
          const content = await readFileSafe(ws, fp);
          sourceFiles.push({ path: fp, content });
        }
      }
    }

    const fixPrompt = `[FIX_BUILD]
The following project has a build error. Analyze and provide fixed file contents.

Build command: ${PM} run build
Error output:
${build.stdout}

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

async function askApproval(question: string): Promise<boolean> {
  if (process.env.AUTO_APPROVE === "true") {
    log("INFO", `${question} → auto-approved`);
    return true;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\n❯ ${question} (y/n): `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

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

async function orchestrate(idea: string): Promise<void> {
  const outputRoot = path.resolve(process.env.OUTPUT_DIR ?? "./output");
  const projectDir = path.join(outputRoot, `project-${Date.now()}`);
  const ctx = createContext(idea, projectDir);

  const agents: AgentStep[] = [
    {
      name: "1 › Idea Analyzer",
      description: "Analyzes the idea, extracts features and tech stack",
      run: ideaAnalyzer,
    },
    {
      name: "2 › Spec Builder",
      description: "Creates detailed project specification and file structure",
      run: specBuilder,
    },
    {
      name: "3 › Code Generator",
      description: "Generates complete source code for every file",
      run: codeGenerator,
    },
    {
      name: "4 › Build & Auto-Fix",
      description: "Installs deps, builds project, auto-fixes errors (max 5 retries)",
      run: buildAndFixAgent,
    },
    {
      name: "5 › Test Runner",
      description: "Runs the project test suite",
      run: testRunner,
    },
    {
      name: "6 › Git Commit",
      description: "Initializes repo and creates initial commit",
      run: gitCommitAgent,
    },
  ];

  const banner = [
    "",
    "╔══════════════════════════════════════════════════════════════╗",
    "║           AI CODING AGENT ORCHESTRATOR                     ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    `  Idea    : ${idea}`,
    `  Output  : ${projectDir}`,
    `  LLM     : ${USE_MOCK ? "MOCK (no API key)" : process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514"}`,
    `  Agents  : ${agents.length}`,
    "",
  ];
  console.log(banner.join("\n"));

  for (const agent of agents) {
    console.log(`\n${"═".repeat(60)}`);
    log("INFO", `Starting: ${agent.name}`);
    log("INFO", agent.description);

    const result = await agent.run(ctx);

    displayResult(agent.name, result);

    if (!result.success) {
      log("ERROR", `Pipeline stopped — ${agent.name} failed: ${result.error}`);
      ctx.errors.push(result.error ?? "Unknown error");
      process.exitCode = 1;
      return;
    }

    const approved = await askApproval(`Approve "${agent.name}" and proceed to next step?`);
    if (!approved) {
      log("WARN", "Pipeline stopped by user");
      return;
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("  Pipeline completed successfully!");
  console.log(`  Project: ${projectDir}`);
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
  node agent.js "<your idea>"
  npx ts-node agent.ts "<your idea>"

Examples:
  node agent.js "build a landing page for selling bikes"
  node agent.js "create a todo app with authentication"

Environment:
  ANTHROPIC_API_KEY   Claude API key (omit for mock/demo mode)
  CLAUDE_MODEL        Model name (default: claude-sonnet-4-20250514)
  LOG_LEVEL           DEBUG | INFO | WARN | ERROR
  AUTO_APPROVE        "true" to skip approval prompts
  OUTPUT_DIR          Root for generated projects (default: ./output)
`);
    return;
  }

  const idea = args.join(" ");
  await orchestrate(idea);
}

main().catch((err) => {
  log("ERROR", "Fatal error", { message: err.message, stack: err.stack });
  process.exitCode = 1;
});
