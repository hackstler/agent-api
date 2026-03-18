import { tool } from "ai";
import { z } from "zod";
import type { CalendarApiService } from "../services/calendar-api.service.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface ListEventsDeps {
  calendarService: CalendarApiService;
}

export function createListEventsTool({ calendarService }: ListEventsDeps) {
  return tool({
    description:
      "List upcoming events from the user's Google Calendar. Requires the user's Google account to be connected.",

    inputSchema: z.object({
      timeMin: z
        .string()
        .optional()
        .describe("Start of time range (ISO 8601 datetime). Defaults to now."),
      timeMax: z.string().optional().describe("End of time range (ISO 8601 datetime)"),
      maxResults: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of events to return (default: 10)"),
    }),

    execute: async ({ timeMin, timeMax, maxResults }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error('Missing userId in request context');
      const events = await calendarService.listEvents(userId, timeMin, timeMax, maxResults ?? 10);
      return {
        events: events.map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start,
          end: e.end,
          location: e.location,
          attendees: e.attendees,
        })),
        totalResults: events.length,
      };
    },
  });
}
