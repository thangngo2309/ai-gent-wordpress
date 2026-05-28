/**
 * Generation Pipeline.
 *
 * High-level pipeline that coordinates:
 *   1. RAG context retrieval
 *   2. UI design system context injection
 *   3. Theme or plugin skill execution (code generation)
 *   4. Hooks + enqueue validation
 *   5. Full validation pipeline
 *   6. ZIP export
 *
 * This pipeline can be invoked from agent.ts or standalone.
 */

import type { GenerationContext } from "../contracts/types.js";
import { wordpressRagSkill } from "../../skills/rag/wordpress-rag.skill.js";
import { wooCommerceRagSkill } from "../../skills/rag/woocommerce-rag.skill.js";
import { themeSkill } from "../../skills/wordpress/theme.skill.js";
import { pluginSkill } from "../../skills/wordpress/plugin.skill.js";
import { zipSkill } from "../../skills/wordpress/zip.skill.js";
import { premiumUiSkill } from "../../skills/ui/premium-ui.skill.js";
import { designSystemSkill } from "../../skills/ui/design-system.skill.js";
import { runValidationPipeline, type ValidationPipelineResult } from "./validation.pipeline.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("generation-pipeline");

export interface GenerationPipelineResult {
  success: boolean;
  filesGenerated: number;
  zipPath: string | null;
  validationReport: ValidationPipelineResult | null;
  ragContextInjected: boolean;
  uiContextInjected: boolean;
  durationMs: number;
}

export async function runGenerationPipeline(
  genCtx: GenerationContext,
): Promise<GenerationPipelineResult> {
  const start = Date.now();
  log.info("Starting generation pipeline…");

  const isPlugin = genCtx.analysis?.projectType === "wordpress_plugin";
  const idea = genCtx.idea ?? "";
  const needsWoo = /woocommerce|woo\b|e-?commerce|shop|store|cart|checkout/i.test(idea);

  // 1. Retrieve RAG context
  const wpRag = await wordpressRagSkill.execute({}, genCtx);
  let ragContext = wpRag.data?.context ?? "";

  if (needsWoo) {
    const wooRag = await wooCommerceRagSkill.execute({}, genCtx);
    ragContext += "\n\n" + (wooRag.data?.context ?? "");
    log.info("WooCommerce RAG context injected");
  }

  const ragContextInjected = ragContext.length > 0;
  if (ragContextInjected) genCtx.ragContext = ragContext;

  // 2. Inject UI design system context (themes only — plugins skip UI layer)
  let uiContextInjected = false;
  if (!isPlugin) {
    try {
      const [uiResult, dsResult] = await Promise.all([
        premiumUiSkill.execute({ includeEcommerce: needsWoo }, genCtx),
        designSystemSkill.execute({ idea }, genCtx),
      ]);

      if (uiResult.success) {
        genCtx.uiPromptBlock = uiResult.data.uiBlock;
        uiContextInjected = true;
        log.info(`UI context injected (ecommerce: ${uiResult.data.includesEcommerce})`);
      }
      if (dsResult.success) {
        genCtx.designSystemCssVars = dsResult.data.cssVars;
        log.info("Design system CSS vars injected");
      }
    } catch (e) {
      // Non-blocking — continue without UI context if skill fails
      log.warn(`UI skill injection failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. Generate theme or plugin
  log.info(`Generating ${isPlugin ? "plugin" : "theme"}…`);

  const fileStructure = genCtx.spec?.fileStructure ?? [];
  let filesGenerated = 0;

  if (isPlugin) {
    const pluginResult = await pluginSkill.execute({ fileStructure, pluginMainFile: `${genCtx.projectSlug}.php` }, genCtx);
    filesGenerated = pluginResult.data?.length ?? 0;
  } else {
    const themeResult = await themeSkill.execute({ fileStructure }, genCtx);
    filesGenerated = themeResult.data?.length ?? 0;
  }

  log.info(`Generated ${filesGenerated} file(s)`);

  // 4. Validate
  log.info("Running validation…");
  let validationReport: ValidationPipelineResult | null = null;
  try {
    validationReport = await runValidationPipeline(genCtx);
    log.info(`Validation: quality ${validationReport.qualityScore}/100, passed: ${validationReport.passed}`);
  } catch (e) {
    log.error(`Validation pipeline error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5. ZIP export
  log.info("Building ZIP archive…");
  let zipPath: string | null = null;
  try {
    const zipResult = await zipSkill.execute(
      {},
      { ...genCtx, workspacePath: genCtx.workspacePath },
    );
    zipPath = zipResult.data?.zipPath ?? null;
    if (zipPath) log.info(`ZIP created: ${zipPath}`);
  } catch (e) {
    log.error(`ZIP build error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    success: filesGenerated > 0 && (validationReport?.passed ?? true),
    filesGenerated,
    zipPath,
    validationReport,
    ragContextInjected,
    uiContextInjected,
    durationMs: Date.now() - start,
  };
}
