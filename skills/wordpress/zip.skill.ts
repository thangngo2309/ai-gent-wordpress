/**
 * WordPress ZIP Export Skill.
 *
 * Creates an upload-ready ZIP archive for WordPress themes and plugins.
 * Wraps src/core/zip.ts with skill interface + validation.
 */

import type {
  GenerationContext,
  ValidationResult,
  ZipExportResult,
} from "../../src/contracts/types.js";
import { BaseSkill, type SkillResult } from "../../src/contracts/skill.js";
import { createUploadZip } from "../../src/core/zip.js";
import * as path from "node:path";

export interface ZipSkillInput {
  /** Output directory for the ZIP (defaults to project dir) */
  outputDir?: string;
}

export type ZipSkillOutput = ZipExportResult;

export class ZipSkill extends BaseSkill<ZipSkillInput, ZipSkillOutput> {
  readonly name = "wordpress/zip";
  readonly description = "Creates an upload-ready ZIP archive for WordPress installation";
  readonly version = "1.0.0";

  validators = [
    (output: ZipSkillOutput): ValidationResult => ({
      valid: output.sizeBytes > 0 && output.files.length > 0,
      errors:
        output.sizeBytes === 0
          ? [{ file: output.zipPath, message: "ZIP file is empty", severity: "error" as const }]
          : [],
      warnings: [],
    }),
  ];

  async execute(
    input: ZipSkillInput,
    ctx: GenerationContext,
  ): Promise<SkillResult<ZipSkillOutput>> {
    const start = Date.now();
    this.logs = [];

    const slug = ctx.projectSlug;
    const outputDir = input.outputDir ?? path.dirname(ctx.workspacePath);

    this.log(`Creating upload-ready ZIP for ${slug}…`);

    try {
      const result = await createUploadZip(ctx.workspacePath, slug, outputDir);
      this.log(
        `ZIP created: ${result.zipPath} (${Math.round(result.sizeBytes / 1024)} KB, ${result.files.length} files)`,
      );
      return this.buildResult(true, result, start);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`ZIP creation failed: ${msg}`);
      return this.buildResult(
        false,
        { zipPath: "", slug, sizeBytes: 0, files: [] },
        start,
        0,
        msg,
      );
    }
  }
}

export const zipSkill = new ZipSkill();
