/**
 * File-system utilities used by skills and agents.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { createLogger } from "./logger.js";

const logger = createLogger("fs");

// ─────────────────────────────────────────────────────────────────────────────
//  SAFE RESOLVE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a file path inside a workspace, preventing path traversal.
 * Throws if the resolved path escapes the workspace root.
 */
export function resolveSafe(workspacePath: string, filePath: string): string {
  const abs = path.resolve(workspacePath, filePath);
  if (!abs.startsWith(path.resolve(workspacePath))) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  return abs;
}

// ─────────────────────────────────────────────────────────────────────────────
//  WRITE
// ─────────────────────────────────────────────────────────────────────────────

export async function writeFileSafe(
  workspacePath: string,
  filePath: string,
  content: string,
): Promise<void> {
  const abs = resolveSafe(workspacePath, filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  logger.debug(`Wrote ${filePath} (${content.length} chars)`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  READ
// ─────────────────────────────────────────────────────────────────────────────

export async function readFileSafe(
  workspacePath: string,
  filePath: string,
): Promise<string> {
  try {
    const abs = resolveSafe(workspacePath, filePath);
    return await fs.readFile(abs, "utf-8");
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LIST
// ─────────────────────────────────────────────────────────────────────────────

/** Recursively list all files under a directory, relative to that directory. */
export async function listFilesSafe(
  workspacePath: string,
  dir = ".",
): Promise<string[]> {
  const abs = resolveSafe(workspacePath, dir);
  if (!existsSync(abs)) return [];

  const entries = await fs.readdir(abs, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join((e as unknown as { parentPath?: string }).parentPath ?? abs, e.name);
      return path.relative(workspacePath, full);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function fileExists(workspacePath: string, filePath: string): boolean {
  try {
    const abs = resolveSafe(workspacePath, filePath);
    return existsSync(abs);
  } catch {
    return false;
  }
}

/** Read a file and return `null` instead of throwing when the file doesn't exist. */
export async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
