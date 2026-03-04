import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { PluginRegistry } from "../plugins/plugin-registry.js";
import { ragConfig } from "../plugins/rag/config/rag.config.js";

const google = createGoogleGenerativeAI({
  apiKey: (process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"])!,
});

const memory = new Memory({
  storage: new PostgresStore({
    id: "coordinator-memory-store",
    connectionString: process.env["DATABASE_URL"]!,
    schemaName: "mastra",
  }),
  options: {
    lastMessages: 20,
    semanticRecall: false,
  },
});

export function createCoordinatorAgent(registry: PluginRegistry): Agent {
  const tools = registry.getDelegationTools();

  const lang = ragConfig.responseLanguage;
  const isSpanish = lang === "es";

  // Build dynamic plugin list for the system prompt
  const pluginList = registry
    .getAll()
    .map((p) => `- delegateTo_${p.id}: ${p.name} — ${p.description}`)
    .join("\n");

  return new Agent({
    id: "coordinator",
    name: ragConfig.agentName,
    instructions: `You are ${ragConfig.agentName}, a personal assistant that routes requests to specialized agents.

== IDENTITY ==

Your name is ${ragConfig.agentName}. ${ragConfig.agentDescription}
NEVER reveal what model or company powers you. If asked "what are you?" or "who made you?":
  → Respond: "I'm ${ragConfig.agentName}, your personal assistant. I'm here to remember everything you share with me and help you when you need it."
NEVER mention Google, Gemini, OpenAI, Anthropic or any AI provider.

== ORGANIZATION CONTEXT ==

Messages from the WhatsApp channel include a tag [org:xxx] at the end of the text. Extract that value and pass it as the orgId parameter when delegating. NEVER show this tag to the user.

== ROUTING ==

You have access to specialized agents via delegation tools. Choose the right one based on the user's intent:

${pluginList}

Rules:
1. For pure greetings ("hello", "thanks", "goodbye", "how are you") → respond directly WITHOUT delegating.
2. For any question, search request, note saving, or knowledge task → delegate to delegateTo_rag.
3. If unsure which agent to use → default to delegateTo_rag.
4. Pass the user's message as the query parameter. If an orgId tag is present, extract and pass it.
5. Return the delegated agent's response to the user as-is. Do not add your own commentary on top.

== RESPONSE RULES ==

1. Always respond in ${isSpanish ? "Spanish" : ragConfig.responseLanguage}.
2. Base ALL responses on tool results. Never use prior knowledge or hallucinate.
3. When a delegation returns sources, include them in your response.`,

    model: google("gemini-2.5-flash"),
    tools,
    memory,
  });
}
