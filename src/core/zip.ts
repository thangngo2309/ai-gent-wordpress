/**
 * ZIP export utilities for WordPress themes and plugins.
 *
 * Creates upload-ready archives that WordPress can install directly from
 * Plugins > Add New > Upload Plugin (or Appearance > Themes > Add New).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync, createWriteStream } from "node:fs";
import { execSync } from "node:child_process";
import { createLogger } from "./logger.js";
import type { ZipExportResult } from "../contracts/types.js";

const logger = createLogger("zip");

/** Files/directories that must never appear in an upload-ready archive */
const EXCLUDED_PATTERNS = [
  ".git",
  ".gitignore",
  ".gitattributes",
  ".agent-artifacts",
  ".agent-checkpoint.json",
  ".router.php",
  "IDEA.md",
  "SPEC.md",
  ".DS_Store",
  "node_modules",
  "vendor",
  "*.zip",
];

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN EXPORT FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an upload-ready ZIP archive of a WordPress theme or plugin.
 *
 * The archive is written to `outputDir` (or `projectDir/..` by default) and
 * contains a single root folder named `slug/`.
 *
 * Returns a ZipExportResult describing the created archive.
 */
export async function createUploadZip(
  projectDir: string,
  slug: string,
  outputDir?: string,
): Promise<ZipExportResult> {
  const absProjectDir = path.resolve(projectDir);
  const absOutputDir = outputDir ? path.resolve(outputDir) : absProjectDir;

  if (!existsSync(absProjectDir)) {
    throw new Error(`Project directory does not exist: ${absProjectDir}`);
  }

  await fs.mkdir(absOutputDir, { recursive: true });

  const zipFileName = `${slug}.zip`;
  const zipPath = path.join(absOutputDir, zipFileName);

  // Remove any existing ZIP with the same name
  if (existsSync(zipPath)) {
    await fs.rm(zipPath, { force: true });
    logger.debug(`Removed existing ${zipFileName}`);
  }

  // Build exclusion args for the `zip` command
  const excludeArgs = EXCLUDED_PATTERNS.flatMap((pat) => ["--exclude", `*/${pat}/*`, "--exclude", `*/${pat}`]);

  // Use system `zip` to create the archive
  // The archive must contain the slug/ prefix so WordPress extracts correctly
  const cmd = [
    "zip",
    "-r",
    "-q",
    zipPath,
    ".",
    ...excludeArgs,
  ].join(" ");

  try {
    execSync(cmd, { cwd: absProjectDir, stdio: "pipe" });
  } catch (err: unknown) {
    throw new Error(`zip command failed: ${(err as Error).message}`);
  }

  // Verify the archive was created
  if (!existsSync(zipPath)) {
    throw new Error(`ZIP was not created at ${zipPath}`);
  }

  const stat = await fs.stat(zipPath);

  // List the files included
  const listCmd = `zip -sf "${zipPath}"`;
  let files: string[] = [];
  try {
    const raw = execSync(listCmd, { encoding: "utf-8", stdio: "pipe" });
    files = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("Archive"));
  } catch {
    // Not critical
  }

  logger.info(`ZIP created: ${zipPath} (${Math.round(stat.size / 1024)} KB, ${files.length} files)`);

  return {
    zipPath,
    slug,
    sizeBytes: stat.size,
    files,
  };
}

/**
 * Rename the root folder inside a ZIP so it matches `slug`.
 *
 * Some generators write files directly to the project dir (no sub-folder).
 * WordPress requires the archive root to be the plugin/theme slug.
 * This function repackages the archive with the correct root folder.
 */
export async function repackageZipWithSlugRoot(
  zipPath: string,
  slug: string,
  tmpDir: string,
): Promise<string> {
  const extractDir = path.join(tmpDir, `repack-${slug}`);
  await fs.mkdir(extractDir, { recursive: true });

  // Extract
  execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`, { stdio: "pipe" });

  // Determine what's in the archive root
  const entries = await fs.readdir(extractDir);
  const absOut = path.dirname(zipPath);
  const newZip = path.join(absOut, `${slug}-packaged.zip`);

  if (entries.length === 1 && entries[0] === slug) {
    // Already correctly structured
    return zipPath;
  }

  // Move everything into a slug/ subfolder
  const slugDir = path.join(extractDir, slug);
  await fs.mkdir(slugDir, { recursive: true });
  for (const entry of entries) {
    if (entry === slug) continue; // avoid circular
    await fs.rename(path.join(extractDir, entry), path.join(slugDir, entry));
  }

  // Re-zip
  execSync(`zip -r -q "${newZip}" "${slug}"`, { cwd: extractDir, stdio: "pipe" });

  // Cleanup
  await fs.rm(extractDir, { recursive: true, force: true });

  return newZip;
}
