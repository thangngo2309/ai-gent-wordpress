/**
 * Shared TypeScript contracts for the AI WordPress Coding Agent.
 *
 * These types mirror the interfaces in agent.ts and provide a typed foundation
 * for the skills/agents/pipeline layers.  agent.ts is still the canonical
 * entrypoint — these exports let new modules share the same shapes without
 * coupling to the monolithic file.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  CORE DOMAIN TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface Feature {
  name: string;
  description: string;
  priority: "high" | "medium" | "low";
  acceptanceCriteria: string[];
}

export interface TechStack {
  frontend: string[];
  backend: string[];
  devtools: string[];
}

export interface UserStory {
  role: string;
  goal: string;
  rationale: string;
}

export interface DesignDirection {
  tone: string;
  colorPalette: string;
  typography: string;
  inspiration: string[];
}

export interface NonFunctionalRequirements {
  performance: string[];
  accessibility: string[];
  seo: string[];
}

export type ProjectType = "wordpress_theme" | "wordpress_plugin";

export interface FeatureAnalysis {
  projectType: ProjectType;
  projectName: string;
  brandName: string;
  summary: string;
  targetAudience: string;
  goals: string[];
  features: Feature[];
  userStories: UserStory[];
  designDirection: DesignDirection;
  nonFunctionalRequirements: NonFunctionalRequirements;
  contentRequirements: string[];
  techStack: TechStack;
}

export interface FileSpec {
  filePath: string;
  description: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
}

export interface ProjectSpec {
  projectType: ProjectType;
  architecture: string;
  fileStructure: FileSpec[];
  apiEndpoints: ApiEndpoint[];
  buildScript: string;
  testScript: string;
}

export interface GeneratedFile {
  filePath: string;
  content: string;
}

export interface BuildFixResponse {
  fixes: GeneratedFile[];
  explanation: string;
}

export interface CommitMessageResponse {
  message: string;
}

export interface AgentResult<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
}

export interface SharedContext {
  idea: string;
  workspacePath: string;
  analysis: FeatureAnalysis | null;
  spec: ProjectSpec | null;
  generatedFiles: GeneratedFile[];
  buildLogs: string[];
  testLogs: string[];
  errors: string[];
  lastVisualReview: unknown | null;
  remoteLlmCallCount?: number;
}

export interface Checkpoint {
  version: number;
  idea: string;
  completedAgents: number[];
  lastAgentIndex: number;
  timestamp: string;
  analysis: FeatureAnalysis | null;
  spec: ProjectSpec | null;
  generatedFiles: GeneratedFile[];
  buildLogs: string[];
  testLogs: string[];
  remoteLlmCallCount?: number;
}

export type ReviewAction = "approve" | "change" | "regenerate" | "quit";

export interface ReviewChoice {
  action: ReviewAction;
  feedback?: string;
}

export type AgentKind =
  | "analysis"
  | "spec"
  | "codegen"
  | "build"
  | "test"
  | "commit";

export interface AgentStep {
  name: string;
  description: string;
  run: (ctx: SharedContext) => Promise<AgentResult>;
  kind: AgentKind;
}

// ─────────────────────────────────────────────────────────────────────────────
//  VALIDATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationError {
  file: string;
  line?: number;
  column?: number;
  rule?: string;
  message: string;
  severity: ValidationSeverity;
}

export type ValidationWarning = ValidationError;

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  /** 0-100 quality score; undefined if not applicable */
  score?: number;
  /** Suggested auto-fix patches keyed by file path */
  fixes?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  GENERATION CONTEXT  (passed into every skill)
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerationContext {
  /** Root directory where files are written */
  workspacePath: string;
  /** User's original idea / brief */
  idea: string;
  analysis: FeatureAnalysis | null;
  spec: ProjectSpec | null;
  generatedFiles: GeneratedFile[];
  remoteLlmCallCount: number;
  /** Slug derived from projectName */
  projectSlug: string;
  /** PHP function/class prefix (underscored slug) */
  phpPrefix: string;
  /** Optional RAG context injected by the RAG skill */
  ragContext?: string;
  /** Premium UI prompt block injected by the UI skills layer */
  uiPromptBlock?: string;
  /** Design system CSS custom properties seeded by the design-system skill */
  designSystemCssVars?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  FILE OUTPUT
// ─────────────────────────────────────────────────────────────────────────────

export interface FileOutput {
  filePath: string;
  content: string;
  /** Byte size of the written content */
  size?: number;
  /** MIME type hint */
  mimeType?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  RETRY PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  /** Delay between retries in ms */
  delayMs: number;
  /** Exponential back-off multiplier (default 1 = no backoff) */
  backoffMultiplier?: number;
  /** If set, only retry when the error message matches this pattern */
  retryOn?: RegExp;
}

export interface RetryPipeline<T> {
  policy: RetryPolicy;
  execute: () => Promise<T>;
  onRetry?: (attempt: number, error: Error) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
//  WORDPRESS-SPECIFIC
// ─────────────────────────────────────────────────────────────────────────────

export interface WordPressThemeManifest {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  textDomain: string;
  requiredFiles: string[];
  supportsWooCommerce: boolean;
}

export interface WordPressPluginManifest {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  textDomain: string;
  mainFile: string;
  requiresWP: string;
  requiresPHP: string;
  supportsWooCommerce: boolean;
}

export interface WordPressSecurityReport {
  passedChecks: string[];
  failedChecks: string[];
  criticalIssues: string[];
  /** true when all critical checks pass */
  clean: boolean;
}

export interface ZipExportResult {
  zipPath: string;
  slug: string;
  sizeBytes: number;
  files: string[];
}
