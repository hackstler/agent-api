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
}
