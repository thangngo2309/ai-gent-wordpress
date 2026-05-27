/**
 * WordPress RAG (Retrieval-Augmented Generation) Context Skill.
 *
 * Provides structured WordPress knowledge context that can be injected into
 * LLM prompts to ground generation in authoritative documentation.
 *
 * This is a lightweight implementation: rather than a full vector store
 * embedding pipeline, it provides curated static reference blocks for the
 * most common WordPress generation scenarios.  A full vector-based RAG
 * implementation can be swapped in by replacing the `retrieve()` method.
 */

import type { GenerationContext } from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────────────────────────

const WP_KNOWLEDGE: Record<string, string> = {
  "theme-file-structure": `
WordPress Theme Required Files:
- style.css          — Contains theme header comment (Theme Name, Version, Text Domain, etc.)
- index.php          — Fallback template (required)
- functions.php      — Theme setup, enqueue, hooks
- header.php         — Included via get_header()
- footer.php         — Included via get_footer()
- sidebar.php        — Included via get_sidebar()
- screenshot.png     — 1200x900px theme preview image (optional but recommended)

Template Hierarchy (simplified):
  Page → page-{slug}.php → page-{id}.php → page.php → singular.php → index.php
  Single Post → single-{post-type}-{slug}.php → single-{post-type}.php → single.php → index.php
  Archive → archive-{post-type}.php → archive.php → index.php
  Front page → front-page.php → home.php → index.php
`,

  "functions-php-boilerplate": `
// Theme setup (runs after WP is fully loaded)
function {prefix}_setup() {
    // Load text domain
    load_theme_textdomain( '{textdomain}', get_template_directory() . '/languages' );
    // Title tag support
    add_theme_support( 'title-tag' );
    // Post thumbnails
    add_theme_support( 'post-thumbnails' );
    // Custom logo
    add_theme_support( 'custom-logo' );
    // Nav menus
    register_nav_menus( array(
        'primary'   => esc_html__( 'Primary Menu', '{textdomain}' ),
        'secondary' => esc_html__( 'Footer Menu', '{textdomain}' ),
    ) );
    // HTML5 support
    add_theme_support( 'html5', array(
        'search-form', 'comment-form', 'comment-list',
        'gallery', 'caption', 'style', 'script',
    ) );
    // Block styles
    add_theme_support( 'wp-block-styles' );
    // Align wide
    add_theme_support( 'align-wide' );
}
add_action( 'after_setup_theme', '{prefix}_setup' );

// Enqueue scripts and styles
function {prefix}_enqueue_scripts() {
    wp_enqueue_style(
        '{prefix}-style',
        get_stylesheet_uri(),
        array(),
        wp_get_theme()->get( 'Version' )
    );
    wp_enqueue_script(
        '{prefix}-main',
        get_template_directory_uri() . '/assets/js/main.js',
        array(),
        wp_get_theme()->get( 'Version' ),
        true // Load in footer
    );
}
add_action( 'wp_enqueue_scripts', '{prefix}_enqueue_scripts' );
`,

  "security-checklist": `
WordPress Security Checklist for Generated Code:

1. ALWAYS add ABSPATH guard to every PHP file (except uninstall.php):
   if ( ! defined( 'ABSPATH' ) ) { exit; }

2. ALWAYS escape output:
   - esc_html()       — for plain text
   - esc_url()        — for URLs
   - esc_attr()       — for HTML attributes
   - wp_kses_post()   — for post content
   - absint()         — for integer IDs

3. ALWAYS sanitize input:
   - sanitize_text_field()
   - sanitize_email()
   - sanitize_url()
   - absint()
   - wp_kses()

4. ALWAYS verify nonces for form submissions:
   wp_nonce_field( 'action_name', 'nonce_name' );
   check_admin_referer( 'action_name', 'nonce_name' );

5. ALWAYS check capabilities before privileged actions:
   if ( ! current_user_can( 'manage_options' ) ) { wp_die( esc_html__( 'Unauthorized' ) ); }

6. NEVER use $wpdb->query() with raw user input — use $wpdb->prepare()
`,

  "plugin-structure": `
WordPress Plugin Required/Recommended Files:
- {slug}.php          — Bootstrap file with plugin header comment
- uninstall.php       — Cleanup on uninstall (check WP_UNINSTALL_PLUGIN)
- readme.txt          — WordPress.org readme format
- includes/           — PHP class files
- assets/             — CSS/JS/Images

Plugin Header Example:
/**
 * Plugin Name:  My Plugin
 * Plugin URI:   https://example.com
 * Description:  Short description.
 * Version:      1.0.0
 * Author:       Author Name
 * Author URI:   https://example.com
 * Text Domain:  my-plugin
 * Domain Path:  /languages
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * License:      GPL-2.0-or-later
 * License URI:  https://spdx.org/licenses/GPL-2.0-or-later.html
 */
`,
};

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface WordPressRagInput {
  /**
   * Keys to retrieve from the knowledge base.
   * Supported: "theme-file-structure", "functions-php-boilerplate",
   *            "security-checklist", "plugin-structure"
   * Pass empty array or undefined to auto-select based on ctx.
   */
  topics?: string[];
}

export interface WordPressRagResult {
  context: string;
  topicsResolved: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export class WordPressRagSkill extends BaseSkill<WordPressRagInput, WordPressRagResult> {
  readonly name = "rag/wordpress";
  readonly description = "Provides curated WordPress knowledge context for LLM prompts";
  readonly version = "1.0.0";

  validators = [];

  async execute(
    input: WordPressRagInput,
    ctx: GenerationContext,
  ): Promise<SkillResult<WordPressRagResult>> {
    const start = Date.now();

    const isTheme = ctx.analysis?.projectType !== "wordpress_plugin";

    // Auto-select topics if none provided
    let topics = input.topics ?? [];
    if (topics.length === 0) {
      topics = isTheme
        ? ["theme-file-structure", "functions-php-boilerplate", "security-checklist"]
        : ["plugin-structure", "security-checklist"];
    }

    const resolved: string[] = [];
    const parts: string[] = [];

    for (const topic of topics) {
      const kb = WP_KNOWLEDGE[topic];
      if (kb) {
        parts.push(`## ${topic}\n${kb}`);
        resolved.push(topic);
      }
    }

    const context = parts.join("\n\n");

    return this.buildResult(
      true,
      { context, topicsResolved: resolved },
      start,
    );
  }
}

export const wordpressRagSkill = new WordPressRagSkill();
