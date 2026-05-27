/**
 * ZIP Builder Agent.
 *
 * Wraps zipSkill to build an upload-ready WordPress ZIP archive
 * and returns a structured result.
 */

import type { SharedContext, AgentResult, ZipExportResult, GenerationContext } from "../contracts/types.js";
import { zipSkill } from "../../skills/wordpress/zip.skill.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("zip-builder-agent");

export async function zipBuilderAgent(
  ctx: SharedContext,
  projectDir: string,
): Promise<AgentResult<ZipExportResult>> {
  log.info(`Building upload-ready ZIP for ${ctx.idea.slice(0, 30)}…`);

  const genCtx: GenerationContext = {
    workspacePath: projectDir,
    projectSlug: "wordpress-project",
    phpPrefix: "theme",
    analysis: ctx.analysis,
    spec: ctx.spec,
    idea: ctx.idea,
    generatedFiles: ctx.generatedFiles,
    remoteLlmCallCount: ctx.remoteLlmCallCount ?? 0,
  };

  const result = await zipSkill.execute({}, genCtx);

  if (result.success && result.data) {
    log.info(`ZIP created: ${result.data.zipPath} (${(result.data.sizeBytes / 1024).toFixed(1)} KB)`);
  } else {
    log.error(`ZIP creation failed: ${result.error}`);
  }

  return {
    success: result.success,
    data: result.data!,
    error: result.error,
  };
}
