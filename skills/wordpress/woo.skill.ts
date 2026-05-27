/**
 * WooCommerce Compatibility Skill.
 *
 * Validates WooCommerce integration in generated themes/plugins:
 * - Checks add_theme_support('woocommerce')
 * - Validates WC() guard patterns
 * - Checks cart/checkout URL helpers
 * - Detects unchecked WC API calls
 */

import type {
  GenerationContext,
  ValidationResult,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { readFileSafe, listFilesSafe } from "../../src/core/fs.js";

export interface WooCompatReport {
  compatible: boolean;
  issues: string[];
  suggestions: string[];
  wooEnabled: boolean;
}

export class WooSkill extends BaseSkill<void, WooCompatReport> {
  readonly name = "wordpress/woo";
  readonly description = "Validates WooCommerce compatibility of generated code";
  readonly version = "1.0.0";

  validators = [
    (output: WooCompatReport): ValidationResult => ({
      valid: output.compatible,
      errors: output.issues.map((msg) => ({
        file: "unknown",
        message: msg,
        severity: "error" as const,
      })),
      warnings: output.suggestions.map((msg) => ({
        file: "unknown",
        message: msg,
        severity: "info" as const,
      })),
    }),
  ];

  async execute(
    _input: void,
    ctx: GenerationContext,
  ): Promise<SkillResult<WooCompatReport>> {
    const start = Date.now();
    this.logs = [];

    // Detect if WooCommerce is explicitly requested
    const ideaLower = ctx.idea.toLowerCase();
    const wooKeywords = ["woocommerce", "woo commerce", "shop", "store", "ecommerce", "e-commerce", "cart", "checkout", "product"];
    const wooEnabled = wooKeywords.some((k) => ideaLower.includes(k));

    if (!wooEnabled) {
      // Scan for accidental WC usage
      return this.scanForAccidentalWcUsage(ctx, start);
    }

    // WooCommerce is requested — validate proper integration
    return this.validateWooIntegration(ctx, start);
  }

  private async scanForAccidentalWcUsage(
    ctx: GenerationContext,
    start: number,
  ): Promise<SkillResult<WooCompatReport>> {
    const issues: string[] = [];
    const phpFiles = (await listFilesSafe(ctx.workspacePath)).filter((f) => f.endsWith(".php"));

    for (const phpFile of phpFiles) {
      const content = await readFileSafe(ctx.workspacePath, phpFile);
      if (!content) continue;

      // Detect unguarded WC calls
      if (/\bWC\s*\(\s*\)->/.test(content) && !content.includes("class_exists( 'WooCommerce' )") && !content.includes("function_exists( 'WC' )")) {
        issues.push(`${phpFile}: unguarded WC() call without WooCommerce availability check`);
      }
      if (/wc_get_(?:cart|checkout)_url\s*\(/.test(content) && !content.includes("function_exists")) {
        issues.push(`${phpFile}: wc_get_*_url() called without function_exists() guard`);
      }
    }

    const output: WooCompatReport = {
      compatible: issues.length === 0,
      issues,
      suggestions: issues.length > 0 ? ["Wrap all WC() calls with class_exists( 'WooCommerce' ) check"] : [],
      wooEnabled: false,
    };
    return this.buildResult(output.compatible, output, start);
  }

  private async validateWooIntegration(
    ctx: GenerationContext,
    start: number,
  ): Promise<SkillResult<WooCompatReport>> {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const isTheme = ctx.analysis?.projectType === "wordpress_theme";

    if (isTheme) {
      const functionsPhp = await readFileSafe(ctx.workspacePath, "functions.php");

      if (functionsPhp) {
        if (!functionsPhp.includes("add_theme_support( 'woocommerce'")) {
          issues.push("functions.php: missing add_theme_support( 'woocommerce' )");
        }
        if (!functionsPhp.includes("add_theme_support( 'wc-product-gallery-zoom'")) {
          suggestions.push("Add add_theme_support( 'wc-product-gallery-zoom' ) for better product gallery");
        }
      }

      // Check for woocommerce.php or woocommerce/ folder
      const allFiles = await listFilesSafe(ctx.workspacePath);
      const hasWooTemplate = allFiles.some((f) => f.startsWith("woocommerce/") || f === "woocommerce.php");
      if (!hasWooTemplate) {
        suggestions.push("Add woocommerce/ template overrides for custom shop layout");
      }
    }

    // Check all PHP files for unguarded WC calls
    const phpFiles = (await listFilesSafe(ctx.workspacePath)).filter((f) => f.endsWith(".php"));
    for (const phpFile of phpFiles) {
      const content = await readFileSafe(ctx.workspacePath, phpFile);
      if (!content) continue;

      if (/WC\s*\(\s*\)->cart\b/.test(content)) {
        const hasGuard = content.includes("instanceof WC_Cart") || content.includes("is_a(") || content.includes("WC()->cart &&");
        if (!hasGuard) {
          issues.push(`${phpFile}: WC()->cart accessed without instanceof WC_Cart guard`);
        }
      }
    }

    const output: WooCompatReport = {
      compatible: issues.length === 0,
      issues,
      suggestions,
      wooEnabled: true,
    };

    this.log(`WooCommerce compatibility: ${output.compatible ? "PASS" : "FAIL"} (${issues.length} issues)`);
    return this.buildResult(output.compatible, output, start);
  }
}

export const wooSkill = new WooSkill();
