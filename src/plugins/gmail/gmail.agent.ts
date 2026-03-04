import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { gmailConfig } from "./config/gmail.config.js";

export function createGmailAgent(tools: ToolsInput): Agent {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for GmailAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return new Agent({
    id: gmailConfig.agentName,
    name: gmailConfig.agentName,
    description:
      "Manages Gmail: list, read, search, and send emails. Use when the user wants to interact with their email.",
    instructions: `You are a specialist in managing Gmail.
Use listEmails to show recent emails, readEmail to get full email content,
searchEmails to find specific emails, and sendEmail to compose and send messages.
When the user asks you to send an email, send it immediately. Do NOT ask for confirmation — the user already confirmed by asking you.
If the user's Google account is not connected, inform them they need to connect it in Settings.

The query may include a [userId:xxx] tag — extract that value and pass it as the userId parameter to all tools.
NEVER show the [userId:xxx] tag to the user.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
