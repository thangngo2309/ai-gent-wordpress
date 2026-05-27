/**
 * Skill base interface + registry.
 *
 * Every skill in skills/ must implement `Skill`.
 * The SkillRegistry provides a lightweight IoC container for skill look-up.
 */

import type {
  GenerationContext,
  ValidationResult,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL RESULT
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillResult<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
  warnings?: string[];
  /** All log messages produced during execution */
  logs: string[];
  /** How many retries were needed (0 = first attempt succeeded) */
  retries: number;
  /** Wall-clock execution time in ms */
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface Skill<TInput = unknown, TOutput = unknown> {
  /** Unique machine-readable identifier, e.g. "wordpress/theme" */
  readonly name: string;

  /** Human-readable description shown in logs and reports */
  readonly description: string;

  /** Semver string for the skill implementation */
  readonly version: string;

  /**
   * Optional system prompt injected into LLM calls made by this skill.
   * Overrides the global system prompt for skill-scoped LLM calls.
   */
  systemPrompt?: string;

  /**
   * Few-shot examples for LLM prompts.
   * Array of { input, output } pairs that demonstrate correct behaviour.
   */
  examples?: Array<{ input: string; output: string }>;

  /**
   * Output validators.  Called after execute() succeeds.
   * Returning `valid: false` causes the skill to be retried (up to retryPolicy.maxAttempts).
   */
  validators?: Array<(output: TOutput, ctx: GenerationContext) => ValidationResult | Promise<ValidationResult>>;

  /** Execute the skill. */
  execute(input: TInput, ctx: GenerationContext): Promise<SkillResult<TOutput>>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ABSTRACT BASE CLASS (convenience)
// ─────────────────────────────────────────────────────────────────────────────

export abstract class BaseSkill<TInput = unknown, TOutput = unknown>
  implements Skill<TInput, TOutput>
{
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly version: string;

  systemPrompt?: string;
  examples?: Array<{ input: string; output: string }>;
  validators?: Array<(output: TOutput, ctx: GenerationContext) => ValidationResult | Promise<ValidationResult>>;

  protected logs: string[] = [];

  protected log(msg: string): void {
    const ts = new Date().toISOString();
    this.logs.push(`[${ts}] [${this.name}] ${msg}`);
    process.stdout.write(`[SKILL:${this.name}] ${msg}\n`);
  }

  abstract execute(input: TInput, ctx: GenerationContext): Promise<SkillResult<TOutput>>;

  protected buildResult<T>(
    success: boolean,
    data: T,
    startMs: number,
    retries = 0,
    error?: string,
    warnings?: string[],
  ): SkillResult<T> {
    return {
      success,
      data,
      error,
      warnings,
      logs: [...this.logs],
      retries,
      durationMs: Date.now() - startMs,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export class SkillRegistry {
  private static instance: SkillRegistry;
  private readonly skills = new Map<string, Skill>();

  static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  get<TInput = unknown, TOutput = unknown>(
    name: string,
  ): Skill<TInput, TOutput> | undefined {
    return this.skills.get(name) as Skill<TInput, TOutput> | undefined;
  }

  getOrThrow<TInput = unknown, TOutput = unknown>(
    name: string,
  ): Skill<TInput, TOutput> {
    const skill = this.get<TInput, TOutput>(name);
    if (!skill) throw new Error(`Skill "${name}" is not registered`);
    return skill;
  }

  list(): string[] {
    return [...this.skills.keys()];
  }
}

/** Singleton registry instance */
export const skillRegistry = SkillRegistry.getInstance();
