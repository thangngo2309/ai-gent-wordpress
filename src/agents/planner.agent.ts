/**
 * Planner Agent.
 *
 * Takes a raw project idea and returns a structured FeatureAnalysis.
 * Wraps the LLM call with the analysis prompt so agent.ts can delegate
 * planning to this module instead of embedding the logic inline.
 */

import type { SharedContext, FeatureAnalysis, AgentResult } from "../contracts/types.js";
import { getDefaultLlmClient } from "../core/llm.js";
import { buildAnalysisPrompt } from "../prompts/generation.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("planner-agent");

export async function plannerAgent(
  ctx: SharedContext,
): Promise<AgentResult<FeatureAnalysis>> {

  log.info("Starting idea analysis…");

  const client = getDefaultLlmClient();
  const prompt = buildAnalysisPrompt(ctx.idea);

  let raw: string;
  try {
    const response = await client.complete(prompt);
    raw = typeof response === "string" ? response : JSON.stringify(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`LLM call failed: ${msg}`);
    return {
      success: false,
      data: null as unknown as FeatureAnalysis,
      error: msg,
    };
  }

  let analysis: FeatureAnalysis;
  try {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    analysis = JSON.parse(jsonMatch ? jsonMatch[1] : raw) as FeatureAnalysis;
  } catch {
    log.error("Failed to parse FeatureAnalysis JSON from LLM response");
    return {
      success: false,
      data: null as unknown as FeatureAnalysis,
      error: "JSON parse error in planner agent",
    };
  }

  log.info(`Analysis complete — project type: ${analysis.projectType}`);

  return {
    success: true,
    data: analysis,
  };
}
