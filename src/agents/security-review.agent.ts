/**
 * Security Review Agent.
 *
 * Runs the SecuritySkill on generated files and optionally calls the LLM
 * to auto-fix detected security issues.
 */

import type { AgentResult, GenerationContext } from "../contracts/types.js";
import { securitySkill } from "../../skills/wordpress/security.skill.js";
import { getDefaultLlmClient } from "../core/llm.js";
import { buildSecurityReviewPrompt } from "../prompts/validation.js";
import { createLogger } from "../core/logger.js";
import { listFilesSafe, readFileSafe } from "../core/fs.js";

const log = createLogger("security-review-agent");

export interface SecurityReviewResult {
  passed: boolean;
  criticalCount: number;
  warningCount: number;
  report: string;
}

export async function securityReviewAgent(
  genCtx: GenerationContext,
  autoFix = false,
): Promise<AgentResult<SecurityReviewResult>> {
  log.info("Running security review…");

  const result = await securitySkill.execute(undefined, genCtx);

  const criticalCount = result.data?.criticalIssues.length ?? 0;
  const warningCount = result.data?.failedChecks.length ?? 0;

  log.info(`Security scan: ${criticalCount} critical, ${warningCount} warnings`);

  // Auto-fix via LLM if requested and issues found
  if (autoFix && criticalCount > 0) {
    log.info("Attempting LLM-based security auto-fix…");

    const allFiles = await listFilesSafe(genCtx.workspacePath);
    const sourceFiles: Record<string, string> = {};
    for (const f of allFiles.filter((x) => x.endsWith(".php"))) {
      const content = await readFileSafe(genCtx.workspacePath, f);
      if (content) sourceFiles[f] = content;
    }

    try {
      const prompt = buildSecurityReviewPrompt(
        Object.entries(sourceFiles).map(([p, content]) => ({ path: p, content })),
        genCtx.projectSlug,
      );
      const client = getDefaultLlmClient();
      const fixResponse = await client.complete(prompt);
      const responseText = typeof fixResponse === "string" ? fixResponse : JSON.stringify(fixResponse);
      log.info(`LLM security fix response received (${responseText.length} chars)`);
    } catch (e) {
      log.error(`Security auto-fix LLM call failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const report = [
    ...(result.data?.criticalIssues ?? []).map((i) => `[CRITICAL] ${i}`),
    ...(result.data?.failedChecks ?? []).map((i) => `[WARNING] ${i}`),
  ].join("\n");

  return {
    success: criticalCount === 0,
    data: {
      passed: criticalCount === 0,
      criticalCount,
      warningCount,
      report,
    },
  };
}
