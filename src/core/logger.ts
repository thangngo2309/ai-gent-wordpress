/**
 * Portable logger module.
 *
 * Wraps the same log levels used in agent.ts so skills and agents can import
 * a typed logger without depending on the monolithic agent.ts.
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function getCurrentLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? "INFO").toUpperCase() as LogLevel;
  return env in LOG_LEVELS ? env : "INFO";
}

export function log(level: LogLevel, msg: string, data?: unknown): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[getCurrentLevel()]) return;

  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const prefix = `[${ts}] [${level}]`;

  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

/**
 * Create a prefixed logger for a named component (e.g. a skill or agent).
 */
export function createLogger(component: string) {
  return {
    debug: (msg: string, data?: unknown) => log("DEBUG", `[${component}] ${msg}`, data),
    info:  (msg: string, data?: unknown) => log("INFO",  `[${component}] ${msg}`, data),
    warn:  (msg: string, data?: unknown) => log("WARN",  `[${component}] ${msg}`, data),
    error: (msg: string, data?: unknown) => log("ERROR", `[${component}] ${msg}`, data),
  };
}

export type ComponentLogger = ReturnType<typeof createLogger>;
