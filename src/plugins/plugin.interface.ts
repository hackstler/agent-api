import type { Hono } from "hono";
import type { AgentRunner } from "../agent/agent-runner.js";
import type { AgentTools } from "../agent/types.js";

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly agent: AgentRunner;
  readonly tools: AgentTools;
  routes?(): Hono;
  ensureTables?(): Promise<void>;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;

  /**
   * Optional hook: resolve a per-org system prompt to override the agent's
   * built-in one. Used when a plugin's behavior depends on org-level config
   * fetched from external systems (e.g. remote business functions).
   *
   * Return null to fall back to the agent's default system prompt.
   */
  resolveSystemForRequest?(orgId: string, lang?: string): Promise<string | null>;

  /**
   * Optional hook: resolve per-org tools to override the plugin's static tools.
   * Used when a tool's inputSchema depends on org-level config (e.g. the
   * quote plugin's calculateBudget tool needs the inputSchema from the org's
   * remote business function so the LLM knows which fields to extract).
   *
   * Return null to fall back to the plugin's default `tools`.
   */
  resolveToolsForRequest?(orgId: string): Promise<AgentTools | null>;
}
