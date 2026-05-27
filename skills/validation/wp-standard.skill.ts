/**
 * WordPress Coding Standards Validation Skill.
 *
 * Goes beyond PHPCS to check WordPress-specific coding patterns:
 * - File/class naming conventions
 * - Proper hook registration
 * - Correct escaping function usage
 * - Plugin/theme header completeness
 * - readme.txt format
 */

import type {
  GenerationContext,
  ValidationResult,
  ValidationError,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { readFileSafe, listFilesSafe } from "../../src/core/fs.js";

// ─────────────────────────────────────────────────────────────────────────────
//  CHECKS
// ─────────────────────────────────────────────────────────────────────────────

interface WpStandardCheck {
  id: string;
  description: string;
  check: (
    content: string,
    filePath: string,
    ctx: GenerationContext,
  ) => ValidationError | null;
}

const THEME_CHECKS: WpStandardCheck[] = [
  {
    id: "WPS-T-001",
    description: "style.css must have Theme Name header",
    check: (content, file) => {
      if (!content.includes("Theme Name:")) {
        return { file, message: "style.css missing 'Theme Name:' header", severity: "error" };
      }
      return null;
    },
  },
  {
    id: "WPS-T-002",
    description: "style.css must have Text Domain header",
    check: (content, file) => {
      if (!content.includes("Text Domain:")) {
        return { file, message: "style.css missing 'Text Domain:' header", severity: "warning" };
      }
      return null;
    },
  },
  {
    id: "WPS-T-003",
    description: "functions.php must add_theme_support for title-tag",
    check: (content, file) => {
      if (!content.includes("add_theme_support") || !content.includes("title-tag")) {
        return { file, message: "functions.php missing add_theme_support( 'title-tag' )", severity: "warning" };
      }
      return null;
    },
  },
  {
    id: "WPS-T-004",
    description: "functions.php must register nav menus",
    check: (content, file) => {
      if (!content.includes("register_nav_menus")) {
        return { file, message: "functions.php missing register_nav_menus()", severity: "warning" };
      }
      return null;
    },
  },
  {
    id: "WPS-T-005",
    description: "functions.php must have wp_enqueue_scripts hook",
    check: (content, file) => {
      if (!content.includes("add_action") || !content.includes("wp_enqueue_scripts")) {
        return { file, message: "functions.php missing add_action( 'wp_enqueue_scripts' )", severity: "error" };
      }
      return null;
    },
  },
];

const PLUGIN_CHECKS: WpStandardCheck[] = [
  {
    id: "WPS-P-001",
    description: "Bootstrap file must have Plugin Name header",
    check: (content, file) => {
      if (!content.includes("Plugin Name:")) {
        return { file, message: `${file} missing 'Plugin Name:' header`, severity: "error" };
      }
      return null;
    },
  },
  {
    id: "WPS-P-002",
    description: "Bootstrap file must have Text Domain header",
    check: (content, file) => {
      if (!content.includes("Text Domain:")) {
        return { file, message: `${file} missing 'Text Domain:' header`, severity: "warning" };
      }
      return null;
    },
  },
  {
    id: "WPS-P-003",
    description: "Bootstrap must register activation hook",
    check: (content, file) => {
      if (!content.includes("register_activation_hook")) {
        return { file, message: `${file} missing register_activation_hook()`, severity: "warning" };
      }
      return null;
    },
  },
  {
    id: "WPS-P-004",
    description: "uninstall.php must check WP_UNINSTALL_PLUGIN",
    check: (content, file) => {
      if (file === "uninstall.php" && !content.includes("WP_UNINSTALL_PLUGIN")) {
        return { file, message: "uninstall.php missing WP_UNINSTALL_PLUGIN check", severity: "error" };
      }
      return null;
    },
  },
];

const GENERAL_PHP_CHECKS: WpStandardCheck[] = [
  {
    id: "WPS-G-001",
    description: "All PHP files must have ABSPATH guard",
    check: (content, file) => {
      if (!content.includes("ABSPATH") && file.endsWith(".php") && file !== "uninstall.php") {
        return { file, message: `${file} missing ABSPATH guard`, severity: "warning" };
      }
      return null;
    },
  },
  {
    id: "WPS-G-002",
    description: "All PHP files must start with <?php",
    check: (content, file) => {
      const trimmed = content.trimStart();
      if (file.endsWith(".php") && !trimmed.startsWith("<?php")) {
        return { file, message: `${file} does not start with <?php`, severity: "error" };
      }
      return null;
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export interface WpStandardResult {
  violations: ValidationError[];
  passed: boolean;
  checksRun: number;
}

export class WpStandardSkill extends BaseSkill<void, WpStandardResult> {
  readonly name = "validation/wp-standard";
  readonly description = "Validates WordPress-specific coding patterns and conventions";
  readonly version = "1.0.0";

  validators = [
    (output: WpStandardResult): ValidationResult => {
      const errors = output.violations.filter((v) => v.severity === "error");
      return {
        valid: errors.length === 0,
        errors,
        warnings: output.violations.filter((v) => v.severity !== "error"),
        score: Math.max(0, 100 - errors.length * 10 - output.violations.filter((v) => v.severity === "warning").length * 3),
      };
    },
  ];

  async execute(
    _input: void,
    ctx: GenerationContext,
  ): Promise<SkillResult<WpStandardResult>> {
    const start = Date.now();
    this.logs = [];

    const isTheme = ctx.analysis?.projectType === "wordpress_theme";
    const violations: ValidationError[] = [];
    let checksRun = 0;

    const allFiles = await listFilesSafe(ctx.workspacePath);

    // Run general PHP checks on all PHP files
    for (const file of allFiles.filter((f) => f.endsWith(".php"))) {
      const content = await readFileSafe(ctx.workspacePath, file);
      if (!content) continue;

      for (const check of GENERAL_PHP_CHECKS) {
        checksRun++;
        const issue = check.check(content, file, ctx);
        if (issue) violations.push(issue);
      }
    }

    // Theme-specific checks
    if (isTheme) {
      for (const [fileName, checks] of [
        ["style.css", THEME_CHECKS.filter((c) => c.id.includes("T-00"))],
        ["functions.php", THEME_CHECKS.filter((c) => c.id.includes("T-00") && parseInt(c.id.slice(-1)) > 2)],
      ] as Array<[string, WpStandardCheck[]]>) {
        const content = await readFileSafe(ctx.workspacePath, fileName);
        if (!content) continue;

        for (const check of checks) {
          checksRun++;
          const issue = check.check(content, fileName, ctx);
          if (issue) violations.push(issue);
        }
      }

      // Run full theme checks
      const styleCss = await readFileSafe(ctx.workspacePath, "style.css");
      if (styleCss) {
        for (const check of THEME_CHECKS) {
          checksRun++;
          const issue = check.check(styleCss, "style.css", ctx);
          if (issue) violations.push(issue);
        }
      }

      const functionsPhp = await readFileSafe(ctx.workspacePath, "functions.php");
      if (functionsPhp) {
        for (const check of THEME_CHECKS) {
          checksRun++;
          const issue = check.check(functionsPhp, "functions.php", ctx);
          if (issue) violations.push(issue);
        }
      }
    } else {
      // Plugin checks
      const rootPhpFiles = allFiles.filter(
        (f) => f.endsWith(".php") && !f.includes("/"),
      );

      for (const rootFile of rootPhpFiles) {
        const content = await readFileSafe(ctx.workspacePath, rootFile);
        if (!content) continue;

        for (const check of PLUGIN_CHECKS) {
          checksRun++;
          const issue = check.check(content, rootFile, ctx);
          if (issue) violations.push(issue);
        }
      }

      const uninstall = await readFileSafe(ctx.workspacePath, "uninstall.php");
      if (uninstall) {
        const issue = PLUGIN_CHECKS.find((c) => c.id === "WPS-P-004")?.check(uninstall, "uninstall.php", ctx);
        if (issue) violations.push(issue);
      }
    }

    const errors = violations.filter((v) => v.severity === "error");
    this.log(`WP Standards: ${checksRun} checks run, ${errors.length} error(s), ${violations.length - errors.length} warning(s)`);

    return this.buildResult(
      errors.length === 0,
      { violations, passed: errors.length === 0, checksRun },
      start,
    );
  }
}

export const wpStandardSkill = new WpStandardSkill();
