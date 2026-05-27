/**
 * Architect Agent.
 *
 * Converts a FeatureAnalysis into a ProjectSpec (file list + requirements).
 * Used by the orchestration pipeline when building the initial spec.
 */

import type { SharedContext, ProjectSpec, AgentResult } from "../contracts/types.js";
import { getDefaultLlmClient } from "../core/llm.js";
import { buildSpecPrompt } from "../prompts/generation.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("architect-agent");

export async function architectAgent(
  ctx: SharedContext,
): Promise<AgentResult<ProjectSpec>> {

  log.info("Building project spec…");

  if (!ctx.analysis) {
    return {
      success: false,
      data: null as unknown as ProjectSpec,
      error: "ctx.analysis is required",
    };
  }

  const client = getDefaultLlmClient();
  const prompt = buildSpecPrompt(ctx.idea, JSON.stringify(ctx.analysis), ctx.analysis.projectType);

  let raw: string;
  try {
    const response = await client.complete(prompt);
    raw = typeof response === "string" ? response : JSON.stringify(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`LLM call failed: ${msg}`);
    return {
      success: false,
      data: null as unknown as ProjectSpec,
      error: msg,
    };
  }

  let spec: ProjectSpec;
  try {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    spec = JSON.parse(jsonMatch ? jsonMatch[1] : raw) as ProjectSpec;
  } catch {
    log.error("Failed to parse ProjectSpec JSON from LLM response");
    return {
      success: false,
      data: null as unknown as ProjectSpec,
      error: "JSON parse error in architect agent",
    };
  }

  log.info(`Spec built — ${spec.fileStructure?.length ?? 0} file(s) planned`);

  return {
    success: true,
    data: spec,
  };
}
