/**
 * Exec utilities — portable wrappers around child_process used by skills.
 */

import { execSync, exec } from "node:child_process";
import { createLogger } from "./logger.js";

const logger = createLogger("exec");

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Synchronous exec with cwd, returns result instead of throwing. */
export function execSafe(cmd: string, cwd: string): ExecResult {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, stdout: stdout ?? "", stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    return {
      success: false,
      stdout: (e.stdout ?? e.message ?? "") as string,
      stderr: (e.stderr ?? "") as string,
      exitCode: e.status ?? 1,
    };
  }
}

/** Async exec with cwd and configurable timeout. */
export function execSafeAsync(
  cmd: string,
  cwd: string,
  timeoutMs = 30_000,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs, encoding: "utf-8" }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          success: false,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: (err as NodeJS.ErrnoException & { code?: number }).code ?? 1,
        });
      } else {
        resolve({ success: true, stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      }
    });
  });
}

/** Check whether a CLI tool is available on PATH. */
export function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Check whether Composer is available and installs a package globally if not. */
export function ensureComposerPackage(
  packageName: string,
  binaryName: string,
): boolean {
  if (commandExists(binaryName)) return true;

  logger.info(`Installing ${packageName} globally via Composer…`);
  const result = execSafe(`composer global require ${packageName}`, process.cwd());
  if (!result.success) {
    logger.warn(`Could not install ${packageName}: ${result.stdout}`);
    return false;
  }
  return commandExists(binaryName);
}
