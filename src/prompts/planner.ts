/**
 * Planner prompts — used by the Planner agent to decompose complex tasks.
 */

import { WORDPRESS_PRODUCTION_SYSTEM_PROMPT } from "./wordpress-system.js";

export function buildPlannerPrompt(idea: string): string {
  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

You are a WordPress project planner. Break down the following idea into an actionable plan.

IDEA: "${idea}"

Determine:
1. What type of WordPress project this is (theme or plugin)
2. What major features are needed
3. What the file structure should look like
4. What the implementation order should be
5. What dependencies/integrations are needed (WooCommerce, Elementor, etc.)

Return JSON:
{
  "projectType": "wordpress_theme" | "wordpress_plugin",
  "projectName": "kebab-case-slug",
  "complexity": "simple" | "medium" | "complex",
  "estimatedFiles": number,
  "phases": [
    {
      "phase": 1,
      "name": "Foundation",
      "files": ["functions.php", "style.css"],
      "rationale": "why these first"
    }
  ],
  "requiredIntegrations": ["WooCommerce", "..."],
  "risks": ["potential issues"],
  "suggestedAgents": ["theme-generator", "validator", "zip-builder"]
}`;
}

export function buildArchitectPrompt(
  idea: string,
  analysis: string,
  projectType: string,
): string {
  const isTheme = projectType === "wordpress_theme";
  return `${WORDPRESS_PRODUCTION_SYSTEM_PROMPT}

You are a WordPress architect. Design the detailed file structure for this project.

IDEA: "${idea}"
PROJECT TYPE: ${projectType}

ANALYSIS:
${analysis}

Design the complete file structure. Every file must have a clear purpose.
${isTheme ? THEME_ARCH_GUIDE : PLUGIN_ARCH_GUIDE}

Return JSON:
{
  "architecture": "description of the architecture pattern",
  "fileStructure": [
    {
      "filePath": "relative/path.php",
      "description": "purpose of this file",
      "dependencies": ["other files this file depends on"]
    }
  ],
  "dataContracts": [
    {
      "function": "${isTheme ? "prefix_get_hero_data" : "prefix_get_settings"}",
      "returns": { "key": "type description" }
    }
  ],
  "hookMap": [
    {
      "hook": "wp_enqueue_scripts",
      "file": "functions.php",
      "purpose": "enqueue theme assets"
    }
  ]
}`;
}

const THEME_ARCH_GUIDE = `
THEME ARCHITECTURE GUIDELINES:
- inc/theme-data.php: centralise ALL demo data in typed functions
- inc/customizer.php: WordPress Customizer settings
- template-parts/: one file per major section (hero, features, cta, etc.)
- assets/css/: separate CSS files per component, imported via wp_enqueue_style
- assets/js/: minimal vanilla JS, enqueued via wp_enqueue_script with defer
- functions.php: only registration and hook setup, no business logic`;

const PLUGIN_ARCH_GUIDE = `
PLUGIN ARCHITECTURE GUIDELINES:
- includes/class-loader.php: action/filter registration
- includes/class-plugin.php: main plugin class, coordinates everything
- includes/class-activator.php: activation routine (DB tables, options)
- includes/class-deactivator.php: deactivation routine
- admin/: admin-only classes, pages, meta boxes
- public/: front-end-facing classes, shortcodes, widgets
- templates/: template files loaded by the plugin (checked via locate_template)`;
