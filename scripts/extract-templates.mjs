#!/usr/bin/env node
/**
 * Extract template files from a project output and convert them to
 * the TypeScript string-array format used in agent.ts mockCodeGen().
 *
 * Usage:
 *   node scripts/extract-templates.mjs <project-dir>
 *
 * Outputs the TypeScript block to stdout. Redirect to a file and
 * manually paste the generated arrays into agent.ts.
 */

import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

const PROJECT_DIR = process.argv[2];
if (!PROJECT_DIR) {
  console.error("Usage: node scripts/extract-templates.mjs <project-dir>");
  process.exit(1);
}

// ─── detect brand from style.css header ────────────────────────────────────
const styleHeader = readFileSync(join(PROJECT_DIR, "style.css"), "utf-8").slice(0, 500);
const themeName = styleHeader.match(/Theme Name:\s*(.+)/)?.[1]?.trim() ?? "My Theme";
const textDomain = styleHeader.match(/Text Domain:\s*(.+)/)?.[1]?.trim() ?? "my-theme";
const prefix = textDomain.replace(/-/g, "_");

console.error(`Detected theme: "${themeName}"  domain: ${textDomain}  prefix: ${prefix}`);

// ─── normalise: replace detected brand names with "Premium Bikes" placeholders
function normalise(src) {
  return src
    .replace(new RegExp(themeName, "g"), "Premium Bikes")
    .replace(new RegExp(textDomain, "g"), "premium-bikes")
    .replace(new RegExp(prefix, "g"), "premium_bikes");
}

// ─── convert a file's text to a TypeScript string-array literal ────────────
function toTSArray(src) {
  const lines = src.split("\n");
  // Remove trailing empty line added by editors
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const items = lines.map((l) => {
    // Escape for double-quoted JS string
    const esc = l
      .replace(/\\/g, "\\\\")   // backslash first
      .replace(/"/g, '\\"')      // double quotes
      .replace(/\$/g, "\\$");    // template-literal dollar signs
    return `        "${esc}"`;
  });
  return `[\n${items.join(",\n")},\n        ""\n      ].join("\\n")`;
}

// ─── files to extract (in order) ───────────────────────────────────────────
const FILES = [
  "style.css",
  "functions.php",
  "inc/theme-data.php",
  "inc/customizer.php",
  "header.php",
  "footer.php",
  "index.php",
  "front-page.php",
  "page.php",
  "404.php",
  "template-parts/hero.php",
  "template-parts/featured-products.php",
  "template-parts/categories.php",
  "template-parts/editorial.php",
  "template-parts/archives-gallery.php",
  "template-parts/about.php",
  "template-parts/back-to-top.php",
  "assets/css/animations.css",
  "assets/js/main.js",
];

const out = [];
for (const rel of FILES) {
  try {
    const raw = readFileSync(join(PROJECT_DIR, rel), "utf-8");
    const norm = normalise(raw);
    const arr = toTSArray(norm);
    out.push(`    {\n      filePath: "${rel}",\n      content: ${arr},\n    },`);
  } catch (e) {
    console.error(`SKIP ${rel}: ${e.message}`);
  }
}

console.log(out.join("\n\n"));
