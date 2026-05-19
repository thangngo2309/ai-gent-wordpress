#!/usr/bin/env node
/**
 * Replace the style.css content block in agent.ts with the new CSS.
 *
 * Usage:
 *   node scripts/replace-css.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");

// ─── 1. Read cleaned CSS ────────────────────────────────────────────────────
let css = readFileSync("/tmp/cleaned.css", "utf-8");

// Remove battery-specific block: .section-hero__battery-visual through glow-pulse keyframe
// We'll do this with a precise range match
css = css.replace(
  /\.section-hero__battery-visual \{[^}]*\}\n\.section-hero__battery-svg \{[^}]*animation: battery-float[^}]*\}\n@keyframes battery-float \{[^}]*\}\n\.section-hero__battery-glow \{[^}]*\}\n@keyframes glow-pulse \{[\s\S]*?\}\n/,
  ""
);
// Fallback: remove any remaining battery- keyframes
css = css.replace(/@keyframes battery-float \{[\s\S]*?\}/g, "");
// Remove responsive battery-visual in @media block
css = css.replace(/\n  \.section-hero__battery-visual \{[\s\S]*?height: 200px;\s*\}/g, "");
// Remove standalone battery-float animation reference
css = css.replace(/\n  animation: battery-float 3s ease-in-out infinite;\n/g, "");

// ─── 2. Build TypeScript content array ─────────────────────────────────────
const lines = css.split("\n");
while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();

const tsItems = lines.map((l) => {
  const esc = l.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `        "${esc}"`;
});

const newContentBlock = `[\n${tsItems.join(",\n")},\n        ""\n      ].join("\\n")`;

// ─── 3. Read agent.ts ───────────────────────────────────────────────────────
const agentPath = join(ROOT, "agent.ts");
const agent = readFileSync(agentPath, "utf-8");

// ─── 4. Find and replace the style.css file block ──────────────────────────
// The block looks like:
//     {
//       filePath: "style.css",
//       content: [...].join("\n"),
//     },
// We'll use a regex to find it precisely
const styleCssBlockRe = /(\s+\{\s*\n\s+filePath: "style\.css",\s*\n\s+content: )\[[\s\S]*?\]\.join\("\\n"\)(,\s*\n\s+\},)/;

const match = agent.match(styleCssBlockRe);
if (!match) {
  console.error("ERROR: Could not find style.css block in agent.ts");
  process.exit(1);
}

const newAgent = agent.replace(
  styleCssBlockRe,
  `$1${newContentBlock}$2`
);

if (newAgent === agent) {
  console.error("ERROR: Replacement produced no change");
  process.exit(1);
}

writeFileSync(agentPath, newAgent, "utf-8");
console.log("✅ Replaced style.css content in agent.ts");
console.log(`   New content: ${lines.length} lines → TS array with ${tsItems.length} items`);
