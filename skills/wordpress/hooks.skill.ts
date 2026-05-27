/**
 * WordPress Hooks Skill.
 *
 * Analyses generated PHP files for correct hook usage and injects missing
 * essential hooks (wp_head, wp_footer, wp_body_open, etc.).
 */

import type {
  GenerationContext,
  GeneratedFile,
  ValidationResult,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { readFileSafe, writeFileSafe } from "../../src/core/fs.js";
import { listFilesSafe } from "../../src/core/fs.js";

// ─────────────────────────────────────────────────────────────────────────────
//  HOOK RULES
// ─────────────────────────────────────────────────────────────────────────────

interface HookRule {
  file: string;
  requiredPattern: RegExp;
  missingMessage: string;
  /** Optional: auto-inject the fix when the hook is absent */
  autoFix?: (content: string) => string;
}

const THEME_HOOK_RULES: HookRule[] = [
  {
    file: "header.php",
    requiredPattern: /wp_head\s*\(\s*\)/,
    missingMessage: "header.php is missing wp_head() before </head>",
    autoFix: (c) => c.replace(/<\/head>/i, "<?php wp_head(); ?>\n</head>"),
  },
  {
    file: "header.php",
    requiredPattern: /wp_body_open\s*\(\s*\)/,
    missingMessage: "header.php is missing wp_body_open() after <body>",
    autoFix: (c) =>
      c.replace(/(<body[^>]*>)/i, "$1\n<?php wp_body_open(); ?>"),
  },
  {
    file: "footer.php",
    requiredPattern: /wp_footer\s*\(\s*\)/,
    missingMessage: "footer.php is missing wp_footer() before </body>",
    autoFix: (c) => c.replace(/<\/body>/i, "<?php wp_footer(); ?>\n</body>"),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface HooksSkillInput {
  /** Leave empty to scan all PHP files in workspace */
  files?: GeneratedFile[];
}

export interface HooksSkillOutput {
  issues: Array<{ file: string; message: string; fixed: boolean }>;
  fixedFiles: GeneratedFile[];
}

export class HooksSkill extends BaseSkill<HooksSkillInput, HooksSkillOutput> {
  readonly name = "wordpress/hooks";
  readonly description = "Validates and auto-fixes WordPress hook usage in generated code";
  readonly version = "1.0.0";

  validators = [
    (output: HooksSkillOutput): ValidationResult => {
      const unfixed = output.issues.filter((i) => !i.fixed);
      return {
        valid: unfixed.length === 0,
        errors: unfixed.map((i) => ({
          file: i.file,
          message: i.message,
          severity: "error" as const,
        })),
        warnings: [],
      };
    },
  ];

  async execute(
    input: HooksSkillInput,
    ctx: GenerationContext,
  ): Promise<SkillResult<HooksSkillOutput>> {
    const start = Date.now();
    this.logs = [];

    const isTheme = ctx.analysis?.projectType === "wordpress_theme";
    const rules = isTheme ? THEME_HOOK_RULES : [];

    const issues: Array<{ file: string; message: string; fixed: boolean }> = [];
    const fixedFiles: GeneratedFile[] = [];

    for (const rule of rules) {
      const content = await readFileSafe(ctx.workspacePath, rule.file);
      if (!content) {
        this.log(`${rule.file} not found — skipping hook check`);
        continue;
      }

      if (!rule.requiredPattern.test(content)) {
        this.log(`Missing hook: ${rule.missingMessage}`);

        let fixed = false;
        if (rule.autoFix) {
          const fixedContent = rule.autoFix(content);
          if (fixedContent !== content) {
            await writeFileSafe(ctx.workspacePath, rule.file, fixedContent);
            fixedFiles.push({ filePath: rule.file, content: fixedContent });
            fixed = true;
            this.log(`Auto-fixed: ${rule.file}`);
          }
        }

        issues.push({ file: rule.file, message: rule.missingMessage, fixed });
      }
    }

    // Generic PHP file scan for common anti-patterns
    const phpFiles = (await listFilesSafe(ctx.workspacePath)).filter((f) => f.endsWith(".php"));
    for (const phpFile of phpFiles) {
      const content = await readFileSafe(ctx.workspacePath, phpFile);

      // Check for eval() usage
      if (/\beval\s*\(/.test(content)) {
        issues.push({
          file: phpFile,
          message: "eval() detected — this is a security violation in WordPress",
          fixed: false,
        });
      }

      // Check for base64_decode() used for execution
      if (/base64_decode\s*\(.*\).*[;,]/.test(content) && /eval\s*\(/.test(content)) {
        issues.push({
          file: phpFile,
          message: "eval(base64_decode()) detected — potential malware pattern",
          fixed: false,
        });
      }
    }

    const output: HooksSkillOutput = { issues, fixedFiles };
    return this.buildResult(
      issues.filter((i) => !i.fixed).length === 0,
      output,
      start,
    );
  }
}

export const hooksSkill = new HooksSkill();
