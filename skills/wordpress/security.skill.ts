/**
 * WordPress Security Skill.
 *
 * Performs a deterministic security scan on generated PHP files, checking for
 * OWASP Top 10 patterns relevant to WordPress.
 *
 * This is a fast, regex-based pre-scan.  For deep analysis, pair it with the
 * PHPStan skill.
 */

import type {
  GenerationContext,
  ValidationResult,
  WordPressSecurityReport,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { readFileSafe, listFilesSafe } from "../../src/core/fs.js";

// ─────────────────────────────────────────────────────────────────────────────
//  SECURITY RULES
// ─────────────────────────────────────────────────────────────────────────────

interface SecurityRule {
  id: string;
  description: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  /** If true, the pattern is a positive assertion (match = bad) */
  matchIsBad: boolean;
}

const SECURITY_RULES: SecurityRule[] = [
  // Critical — never acceptable
  {
    id: "WP-SEC-001",
    description: "eval() usage detected",
    pattern: /\beval\s*\(/,
    severity: "critical",
    matchIsBad: true,
  },
  {
    id: "WP-SEC-002",
    description: "base64_decode() with eval (code injection pattern)",
    pattern: /eval\s*\(\s*base64_decode/,
    severity: "critical",
    matchIsBad: true,
  },
  {
    id: "WP-SEC-003",
    description: "preg_replace() with /e modifier (code injection)",
    pattern: /preg_replace\s*\(\s*['"]\//,
    severity: "critical",
    matchIsBad: false, // checked separately below
  },
  {
    id: "WP-SEC-004",
    description: "Shell execution function (exec/shell_exec/system/passthru)",
    pattern: /\b(?:shell_exec|system|passthru|proc_open|popen)\s*\(/,
    severity: "critical",
    matchIsBad: true,
  },
  {
    id: "WP-SEC-005",
    description: "Unserialise on user input (deserialization attack)",
    pattern: /unserialize\s*\(\s*\$_(?:POST|GET|REQUEST|COOKIE)/,
    severity: "critical",
    matchIsBad: true,
  },

  // High — must fix
  {
    id: "WP-SEC-010",
    description: "Direct $_POST/$_GET access without sanitisation",
    pattern: /\$_(?:POST|GET|REQUEST)\s*\[/,
    severity: "high",
    matchIsBad: true, // handled as warning — context needed
  },
  {
    id: "WP-SEC-011",
    description: "Missing wp_verify_nonce() in form handler",
    pattern: /\$_POST\[/,
    severity: "high",
    matchIsBad: true, // partial — needs contextual check
  },
  {
    id: "WP-SEC-012",
    description: "SQL query with direct string interpolation (possible SQLi)",
    pattern: /\$wpdb->(?:query|get_results|get_row|get_col|get_var)\s*\(\s*["'`][^"'`]*\$_/,
    severity: "high",
    matchIsBad: true,
  },
];

// Checks that SHOULD be present
const POSITIVE_CHECKS: Array<{ id: string; file: string; pattern: RegExp; description: string }> = [
  {
    id: "WP-POS-001",
    file: "header.php",
    pattern: /defined\s*\(\s*['"]ABSPATH['"]\s*\)/,
    description: "ABSPATH guard in header.php",
  },
  {
    id: "WP-POS-002",
    file: "functions.php",
    pattern: /defined\s*\(\s*['"]ABSPATH['"]\s*\)/,
    description: "ABSPATH guard in functions.php",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export type SecuritySkillOutput = WordPressSecurityReport;

export class SecuritySkill extends BaseSkill<void, SecuritySkillOutput> {
  readonly name = "wordpress/security";
  readonly description = "Scans generated PHP files for WordPress security violations";
  readonly version = "1.0.0";

  validators = [
    (output: SecuritySkillOutput): ValidationResult => ({
      valid: output.clean,
      errors: output.criticalIssues.map((msg) => ({
        file: "unknown",
        message: msg,
        severity: "error" as const,
      })),
      warnings: output.failedChecks.map((msg) => ({
        file: "unknown",
        message: msg,
        severity: "warning" as const,
      })),
    }),
  ];

  async execute(
    _input: void,
    ctx: GenerationContext,
  ): Promise<SkillResult<SecuritySkillOutput>> {
    const start = Date.now();
    this.logs = [];

    const phpFiles = (await listFilesSafe(ctx.workspacePath)).filter(
      (f) => f.endsWith(".php") && !f.includes(".router.php"),
    );

    const criticalIssues: string[] = [];
    const failedChecks: string[] = [];
    const passedChecks: string[] = [];

    for (const phpFile of phpFiles) {
      const content = await readFileSafe(ctx.workspacePath, phpFile);
      if (!content) continue;

      for (const rule of SECURITY_RULES) {
        if (rule.id === "WP-SEC-003") {
          // Special: check for /e modifier explicitly
          if (/preg_replace\s*\(\s*['"][^'"]*\/e[imsxuADSUXJ]*['"]/.test(content)) {
            criticalIssues.push(`${rule.id} in ${phpFile}: preg_replace() with /e modifier`);
          }
          continue;
        }

        if (rule.matchIsBad && rule.pattern.test(content)) {
          const msg = `${rule.id} in ${phpFile}: ${rule.description}`;
          if (rule.severity === "critical") {
            criticalIssues.push(msg);
            this.log(`CRITICAL: ${msg}`);
          } else {
            failedChecks.push(msg);
          }
        }
      }

      // ABSPATH guard check (each PHP file should have it — skip style.css obviously)
      if (!content.includes("ABSPATH") && phpFile.endsWith(".php")) {
        failedChecks.push(`WP-POS-000 in ${phpFile}: Missing ABSPATH guard`);
      }
    }

    // Positive checks
    for (const check of POSITIVE_CHECKS) {
      const content = await readFileSafe(ctx.workspacePath, check.file);
      if (content && check.pattern.test(content)) {
        passedChecks.push(`${check.id}: ${check.description}`);
      } else if (content) {
        failedChecks.push(`${check.id} missing: ${check.description}`);
      }
    }

    const output: SecuritySkillOutput = {
      passedChecks,
      failedChecks,
      criticalIssues,
      clean: criticalIssues.length === 0,
    };

    this.log(
      `Security scan: ${passedChecks.length} passed, ${failedChecks.length} warnings, ${criticalIssues.length} critical`,
    );

    return this.buildResult(output.clean, output, start);
  }
}

export const securitySkill = new SecuritySkill();
