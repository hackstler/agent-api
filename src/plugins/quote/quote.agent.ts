import { AgentRunner } from "../../agent/agent-runner.js";
import type { AgentTools } from "../../agent/types.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { quoteConfig } from "./config/quote.config.js";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";
import type { QuoteStrategy } from "./strategies/index.js";

export function createQuoteAgent(tools: AgentTools, strategy: QuoteStrategy): AgentRunner {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for QuoteAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const lang = ragConfig.responseLanguage === "es" ? "espa\u00f1ol" : ragConfig.responseLanguage;

  return new AgentRunner({
    system: strategy.getAgentInstructions(lang),
    model: google(ragConfig.llmModel),
    tools,
  });
}
