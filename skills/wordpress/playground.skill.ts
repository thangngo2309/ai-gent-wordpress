/**
 * WordPress Playground Skill.
 *
 * Prepares a WordPress Playground blueprint for rapid sandboxed testing of
 * generated themes and plugins without requiring a local Docker setup.
 *
 * Output is a blueprint JSON that can be passed to @wp-playground/cli or
 * opened at https://playground.wordpress.net/?blueprint-url=...
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  GenerationContext,
  ValidationResult,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { zipSkill } from "./zip.skill.js";

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface PlaygroundBlueprint {
  landingPage: string;
  preferredVersions: {
    php: string;
    wp: string;
  };
  steps: PlaygroundStep[];
}

type PlaygroundStep =
  | { step: "installTheme"; themeZipFile: { resource: "url" | "literal"; url?: string; contents?: string } }
  | { step: "activateTheme"; themeFolderName: string }
  | { step: "installPlugin"; pluginZipFile: { resource: "url" | "literal"; url?: string } }
  | { step: "activatePlugin"; pluginPath: string }
  | { step: "login" }
  | { step: "setSiteLanguage"; language: string };

export interface PlaygroundSkillOutput {
  blueprintPath: string;
  blueprintJson: PlaygroundBlueprint;
  zipPath: string;
}

export interface PlaygroundSkillInput {
  /** WordPress version to use (default: "latest") */
  wpVersion?: string;
  /** PHP version to use (default: "8.2") */
  phpVersion?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL
// ─────────────────────────────────────────────────────────────────────────────

export class PlaygroundSkill extends BaseSkill<PlaygroundSkillInput, PlaygroundSkillOutput> {
  readonly name = "wordpress/playground";
  readonly description = "Generates a WordPress Playground blueprint for sandboxed testing";
  readonly version = "1.0.0";

  validators = [
    (output: PlaygroundSkillOutput): ValidationResult => ({
      valid: output.zipPath.length > 0,
      errors: output.zipPath.length === 0
        ? [{ file: "blueprint.json", message: "ZIP was not created", severity: "error" as const }]
        : [],
      warnings: [],
    }),
  ];

  async execute(
    input: PlaygroundSkillInput,
    ctx: GenerationContext,
  ): Promise<SkillResult<PlaygroundSkillOutput>> {
    const start = Date.now();
    this.logs = [];

    const wpVersion = input.wpVersion ?? "latest";
    const phpVersion = input.phpVersion ?? "8.2";
    const isTheme = ctx.analysis?.projectType === "wordpress_theme";
    const slug = ctx.projectSlug;

    // Create the ZIP first
    this.log(`Building ZIP for Playground…`);
    const zipResult = await zipSkill.execute({}, ctx);
    if (!zipResult.success) {
      return this.buildResult(
        false,
        { blueprintPath: "", blueprintJson: {} as PlaygroundBlueprint, zipPath: "" },
        start,
        0,
        zipResult.error,
      );
    }

    // Build blueprint
    const blueprint: PlaygroundBlueprint = {
      landingPage: isTheme ? "/" : "/wp-admin/",
      preferredVersions: { php: phpVersion, wp: wpVersion },
      steps: [
        { step: "login" },
        isTheme
          ? ({
              step: "installTheme",
              themeZipFile: { resource: "url", url: `file://${zipResult.data.zipPath}` },
            } as PlaygroundStep)
          : ({
              step: "installPlugin",
              pluginZipFile: { resource: "url", url: `file://${zipResult.data.zipPath}` },
            } as PlaygroundStep),
        isTheme
          ? ({ step: "activateTheme", themeFolderName: slug } as PlaygroundStep)
          : ({ step: "activatePlugin", pluginPath: `${slug}/${slug}.php` } as PlaygroundStep),
      ],
    };

    // Write blueprint JSON
    const blueprintPath = path.join(ctx.workspacePath, ".agent-artifacts", "blueprint.json");
    await fs.mkdir(path.dirname(blueprintPath), { recursive: true });
    await fs.writeFile(blueprintPath, JSON.stringify(blueprint, null, 2), "utf-8");

    this.log(`Blueprint written: ${blueprintPath}`);

    const output: PlaygroundSkillOutput = {
      blueprintPath,
      blueprintJson: blueprint,
      zipPath: zipResult.data.zipPath,
    };

    return this.buildResult(true, output, start);
  }
}

export const playgroundSkill = new PlaygroundSkill();
