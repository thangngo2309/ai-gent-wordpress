/**
 * Validation prompts — used by validation skills and buildAndFixAgent.
 */

import { WORDPRESS_PRODUCTION_SYSTEM_PROMPT } from "./wordpress-system.js";

// ─────────────────────────────────────────────────────────────────────────────
//  PHP RUNTIME FIX PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export function buildRuntimeFixPrompt(
  errors: string[],
  devOutput: string,
  sourceFiles: Array<{ path: string; content: string }>,
  isTheme: boolean,
): string {
  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

You are fixing PHP RUNTIME errors in a WordPress ${isTheme ? "theme" : "plugin"} running on PHP's built-in dev server.
The environment uses stub functions (no real WordPress) so some WP functions are no-ops.

RUNTIME ERRORS:
${errors.join("\n")}

FULL SERVER STDERR (last 3 000 chars):
${devOutput.slice(-3000)}

SOURCE SNIPPETS:
${sourceFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n")}

COMMON CAUSES & FIXES:
- "Call to undefined function X()" → function not included or misspelled; add require_once or fix the call
- "Cannot redeclare function X()" → file loaded twice; use require_once instead of require/include
- "Argument #1 must be of type int|float, string given" for number_format() → cast: (float) $val
- "Undefined array key 'foo'" → template accesses key not returned by inc/theme-data.php;
  check the exact return array, use only those keys
- "Cannot access offset of type string on string" → same root cause as above
- Missing data field → read inc/theme-data.php carefully, fix callers to match exact keys

Return JSON:
{
  "explanation": "concise summary of what was fixed and why",
  "files": [
    { "path": "relative/path.php", "content": "complete corrected file content" }
  ]
}

RULES:
- Fix ALL listed errors, not just the first
- Return COMPLETE file contents (not diffs)
- Do NOT remove ABSPATH checks
- Data keys in templates MUST match keys defined in inc/theme-data.php
- Modify ONLY files directly involved in the listed errors`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHPCS AUTO-FIX PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export function buildPhpcsFixPrompt(
  phpcsOutput: string,
  sourceFiles: Array<{ path: string; content: string }>,
  projectSlug: string,
): string {
  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

You are fixing WordPress Coding Standards (PHPCS) violations in a WordPress project.
Text domain: ${projectSlug}

PHPCS VIOLATIONS:
${phpcsOutput.slice(0, 4000)}

SOURCE FILES TO FIX:
${sourceFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n").slice(0, 8000)}

COMMON WPCS FIXES:
- Indentation: use tabs, not spaces
- Yoda conditions: if ( 'value' === $var ) not if ( $var === 'value' )
- Space after keywords: if (, foreach (, function name(
- Opening brace on same line: if ( condition ) {
- All output must be escaped: esc_html(), esc_url(), esc_attr()
- All input must be sanitised: sanitize_text_field(), absint(), etc.
- Missing nonce: add wp_nonce_field() + wp_verify_nonce()
- Missing ABSPATH check: add if ( ! defined( 'ABSPATH' ) ) { exit; }
- Translation: wrap strings in __() or _e() with text domain '${projectSlug}'

Return JSON:
{
  "explanation": "what violations were fixed",
  "files": [
    { "path": "relative/path.php", "content": "complete corrected file content" }
  ]
}

Return ONLY files that needed changes. Return COMPLETE file contents.`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHPSTAN AUTO-FIX PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export function buildPhpstanFixPrompt(
  phpstanOutput: string,
  sourceFiles: Array<{ path: string; content: string }>,
): string {
  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

You are fixing PHPStan static analysis errors in a WordPress project.

PHPSTAN ERRORS:
${phpstanOutput.slice(0, 4000)}

SOURCE FILES:
${sourceFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n").slice(0, 8000)}

COMMON PHPSTAN FIXES:
- Undefined variable → initialise before use
- Possibly null → add null check before calling method on result
- Wrong type passed → cast or check type before passing
- Dead code → remove unreachable branches
- Method/property does not exist → verify WP API usage

Return JSON:
{
  "explanation": "what was fixed",
  "files": [
    { "path": "relative/path.php", "content": "complete corrected file content" }
  ]
}

Return COMPLETE file contents for modified files only.`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECURITY REVIEW PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export function buildSecurityReviewPrompt(
  sourceFiles: Array<{ path: string; content: string }>,
  projectSlug: string,
): string {
  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

Perform a security review of this WordPress project.
Project slug: ${projectSlug}

SOURCE FILES:
${sourceFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n").slice(0, 10000)}

Check for these OWASP / WordPress-specific security issues:
1. SQL injection (unparameterised $wpdb queries)
2. XSS — output not escaped with esc_html/esc_url/esc_attr/wp_kses
3. CSRF — forms without wp_nonce_field() / wp_verify_nonce()
4. Privilege escalation — privileged actions without current_user_can()
5. File inclusion vulnerabilities
6. PHP code injection (eval, preg_replace with /e, create_function)
7. SSRF (user-controlled URLs in HTTP requests)
8. Hardcoded credentials
9. Missing ABSPATH guards
10. Unserialise on untrusted data

Return JSON:
{
  "passedChecks": ["check description"],
  "failedChecks": ["check: file:line — description"],
  "criticalIssues": ["critical issue descriptions"],
  "clean": true | false
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  WOOCOMMERCE COMPATIBILITY PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export function buildWooCompatibilityPrompt(
  sourceFiles: Array<{ path: string; content: string }>,
  projectSlug: string,
): string {
  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

Review WooCommerce compatibility for this WordPress project.
Project slug: ${projectSlug}

SOURCE FILES:
${sourceFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n").slice(0, 8000)}

Check:
1. add_theme_support( 'woocommerce' ) present in functions.php
2. All WC() calls guarded with class_exists( 'WooCommerce' )
3. WC()->cart checked before access
4. Template overrides in woocommerce/ subfolder only
5. WooCommerce hooks used instead of raw PHP for content injection
6. Cart/checkout redirect uses wc_get_cart_url() / wc_get_checkout_url()

Return JSON:
{
  "compatible": true | false,
  "issues": ["description of each compatibility issue"],
  "suggestions": ["improvement suggestions"],
  "requiredFiles": ["woocommerce/cart/cart.php"]
}`;
}
