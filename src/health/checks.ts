/**
 * Health Checks.
 *
 * Verifies that required and optional tools are available before running
 * the generation pipeline. Returns a structured report that agent.ts can
 * print at startup to inform the user about missing dependencies.
 */

import { commandExists } from "../core/exec.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("health");

export interface ToolCheck {
  name: string;
  command: string;
  available: boolean;
  required: boolean;
  installHint: string;
}

export interface HealthReport {
  healthy: boolean;
  checks: ToolCheck[];
  warnings: string[];
  errors: string[];
}

const TOOL_DEFINITIONS: Omit<ToolCheck, "available">[] = [
  {
    name: "PHP",
    command: "php",
    required: true,
    installHint: "Install PHP 7.4+ from https://www.php.net or via your package manager",
  },
  {
    name: "PHPCS",
    command: "phpcs",
    required: false,
    installHint: "composer global require squizlabs/php_codesniffer",
  },
  {
    name: "PHPStan",
    command: "phpstan",
    required: false,
    installHint: "composer global require phpstan/phpstan",
  },
  {
    name: "zip",
    command: "zip",
    required: true,
    installHint: "Install zip via your package manager (e.g. brew install zip)",
  },
  {
    name: "Composer",
    command: "composer",
    required: false,
    installHint: "Download from https://getcomposer.org",
  },
  {
    name: "WP-CLI",
    command: "wp",
    required: false,
    installHint: "Download from https://wp-cli.org",
  },
];

export function runHealthChecks(): HealthReport {
  const checks: ToolCheck[] = TOOL_DEFINITIONS.map((def) => ({
    ...def,
    available: commandExists(def.command),
  }));

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const check of checks) {
    if (!check.available) {
      const msg = `${check.name} not found — ${check.installHint}`;
      if (check.required) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  const healthy = errors.length === 0;

  if (!healthy) {
    log.error("Health check failed — required tools missing");
    for (const e of errors) log.error(e);
  }

  for (const w of warnings) {
    log.warn(w);
  }

  return { healthy, checks, warnings, errors };
}

export function printHealthReport(report: HealthReport): void {
  console.log("\n─── Health Check ───────────────────────────────────────────");
  for (const check of report.checks) {
    const icon = check.available ? "✓" : check.required ? "✗" : "⚠";
    const label = check.available ? "available" : check.required ? "MISSING (required)" : "not installed (optional)";
    console.log(`  ${icon}  ${check.name.padEnd(12)} ${label}`);
  }
  console.log("────────────────────────────────────────────────────────────\n");
}
