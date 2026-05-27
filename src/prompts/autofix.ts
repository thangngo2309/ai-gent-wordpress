/**
 * Auto-fix prompts — used by the buildAndFixAgent and AutoFix agent.
 */

import { WORDPRESS_PRODUCTION_SYSTEM_PROMPT } from "./wordpress-system.js";

// ─────────────────────────────────────────────────────────────────────────────
//  GENERIC AUTO-FIX PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export function buildAutoFixPrompt(
  errorType: string,
  errors: string[],
  sourceFiles: Array<{ path: string; content: string }>,
  contextFiles: Array<{ path: string; content: string }>,
  projectSlug: string,
): string {
  const context = contextFiles.length > 0
    ? `\nCONTEXT FILES (do not modify — reference only):\n${contextFiles.map((f) => `=== ${f.path} ===\n${f.content.slice(0, 1000)}`).join("\n")}`
    : "";

  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

You are fixing ${errorType} errors in a WordPress project.
Project slug: ${projectSlug}

ERRORS TO FIX:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

SOURCE FILES (modify these):
${sourceFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n")}
${context}

Return JSON:
{
  "explanation": "brief description of all fixes applied",
  "files": [
    { "path": "relative/path.php", "content": "complete corrected content" }
  ]
}

Rules:
- Return COMPLETE file contents (not diffs or snippets)
- Fix ALL errors listed, not just the first
- Keep existing functionality intact
- Follow WordPress Coding Standards
- Only return files that were actually modified`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  THEME CONTRACT REPAIR PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export function buildThemeContractRepairPrompt(
  issues: Array<{
    file: string;
    line?: number;
    message: string;
    severity: string;
  }>,
  sourceFiles: Array<{ path: string; content: string }>,
  phpPrefix: string,
): string {
  const issueList = issues
    .map((i) => `  [${i.severity.toUpperCase()}] ${i.file}${i.line ? `:${i.line}` : ""} — ${i.message}`)
    .join("\n");

  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

You are repairing theme contract violations in a WordPress theme.
PHP prefix: ${phpPrefix}_

THEME CONTRACT ISSUES:
${issueList}

SOURCE FILES:
${sourceFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n")}

THEME CONTRACT RULES:
1. inc/theme-data.php is the SINGLE source of demo data
2. Every data function must be prefixed: ${phpPrefix}_
3. Template-parts may ONLY call functions defined in inc/theme-data.php
4. Every key accessed in templates ($data['key']) must exist in the return array of the data function
5. Menu location registered in functions.php and used in header.php must match exactly
6. No undefined function calls in templates
7. No direct database queries in templates

Return JSON:
{
  "explanation": "what was repaired",
  "files": [
    { "path": "relative/path.php", "content": "complete corrected content" }
  ]
}

Return COMPLETE file contents. Fix ALL listed issues.`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  VISUAL POLISH PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export function buildVisualPolishPrompt(
  visualScore: number,
  visualFeedback: string,
  sourceFiles: Array<{ path: string; content: string }>,
  cssVars: string,
): string {
  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

You are improving the visual quality of a WordPress theme.
Current visual score: ${visualScore}/100

VISUAL FEEDBACK FROM SCREENSHOT ANALYSIS:
${visualFeedback}

CSS VARIABLES IN USE:
${cssVars}

SOURCE FILES:
${sourceFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n")}

Focus ONLY on visual improvements:
- Layout and spacing
- Typography hierarchy
- Color contrast (WCAG AA minimum: 4.5:1 for body text)
- Responsive behaviour at mobile (390px) and tablet (768px)
- Image aspect ratios and object-fit
- Hero section readability

Do NOT:
- Change PHP logic
- Add new data keys not in inc/theme-data.php
- Change the menu/anchor structure
- Add remote image URLs

Return JSON:
{
  "explanation": "visual improvements applied",
  "files": [
    { "path": "relative/path", "content": "complete content" }
  ]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  RETRY PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildRetryPrompt(
  originalPrompt: string,
  previousAttempt: string,
  failureReason: string,
): string {
  return `${originalPrompt}

⚠️  PREVIOUS ATTEMPT FAILED — reason: ${failureReason}

Previous response (incorrect):
${previousAttempt.slice(0, 1000)}

Please try again, addressing the failure reason. Ensure the output is complete and valid.`;
}
