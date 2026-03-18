import { AgentRunner } from "../../agent/agent-runner.js";
import type { AgentTools } from "../../agent/types.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { calendarConfig } from "./config/calendar.config.js";
import { ragConfig } from "../rag/config/rag.config.js";

export function createCalendarAgent(tools: AgentTools): AgentRunner {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for CalendarAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return new AgentRunner({
    system: `You are a specialist in managing Google Calendar.
Use listCalendarEvents to show upcoming events, createCalendarEvent to schedule new events,
updateCalendarEvent to modify existing events, and deleteCalendarEvent to remove events.
Always confirm with the user before creating, updating, or deleting events.
If the user's Google account is not connected, inform them they need to connect it in Settings.
When creating events, make sure to ask for date, time, and duration if not provided.`,
    model: google(ragConfig.llmModel),
    tools,
  });
}
