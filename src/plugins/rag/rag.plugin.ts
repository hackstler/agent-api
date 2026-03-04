import { Hono } from "hono";
import type { Agent } from "@mastra/core/agent";
import type { Plugin } from "../plugin.interface.js";
import { ragAgent, ragTools } from "./rag.agent.js";
import { createChatRoutes } from "./routes/chat.routes.js";
import { createIngestRoutes } from "./routes/ingest.routes.js";

export class RagPlugin implements Plugin {
  readonly id = "rag";
  readonly name = "RAG Plugin";
  readonly description = "Retrieval-Augmented Generation with hybrid search, ingestion, and chat";
  readonly agent = ragAgent;
  readonly tools = ragTools;
  private coordinatorAgent?: Agent;

  setCoordinatorAgent(agent: Agent): void {
    this.coordinatorAgent = agent;
  }

  routes(): Hono {
    const app = new Hono();

    // Use coordinator if available (enables Gmail/Calendar delegation from dashboard)
    app.route("/chat", createChatRoutes(this.coordinatorAgent ?? this.agent));
    app.route("/ingest", createIngestRoutes());

    return app;
  }
}
