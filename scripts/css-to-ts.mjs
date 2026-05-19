#!/usr/bin/env node
/**
 * Convert a CSS file to a TypeScript string-array compatible with agent.ts mockCodeGen.
 * Outputs a single "content: [...].join('\n')" block suitable for pasting.
 *
 * Usage:
 *   node scripts/css-to-ts.mjs <input.css>
 */
import { readFileSync } from "fs";

const input = process.argv[2];
if (!input) { console.error("Usage: node scripts/css-to-ts.mjs <input.css>"); process.exit(1); }

let src = readFileSync(input, "utf-8");

// ─── remove battery-specific block (.section-hero__battery-visual ... @media …)
// Lines 1973–2037 in the original file — we do a block regex removal
src = src.replace(
  /\.section-hero__battery-visual \{[\s\S]*?\.section-hero__battery-glow \{[\s\S]*?\}\s*@keyframes glow-pulse \{[\s\S]*?\}/,
  ""
);
// Remove the battery-float keyframe
src = src.replace(/@keyframes battery-float \{[\s\S]*?\}/g, "");
// Remove battery-float animation reference that stays on .section-hero__battery-svg
src = src.replace(/  animation: battery-float 3s ease-in-out infinite;\n/g, "");

// Remove the responsive battery-visual block inside @media
src = src.replace(/  \.section-hero__battery-visual \{[\s\S]*?height: 200px;\s*\}/g, "");

// ─── convert to TS array
const lines = src.split("\n");
// Remove trailing blank lines
while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();

const items = lines.map((l) => {
  const esc = l
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`");
  return `        "${esc}"`;
});

const block = `[\n${items.join(",\n")},\n        ""\n      ].join("\\n")`;
console.log(`      content: ${block},`);
