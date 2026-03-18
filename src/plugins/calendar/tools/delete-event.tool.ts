import { tool } from "ai";
import { z } from "zod";
import type { CalendarApiService } from "../services/calendar-api.service.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface DeleteEventDeps {
  calendarService: CalendarApiService;
}

export function createDeleteEventTool({ calendarService }: DeleteEventDeps) {
  return tool({
    description:
      "Delete an event from the user's Google Calendar. This action is irreversible.",

    inputSchema: z.object({
      eventId: z.string().describe("ID of the calendar event to delete"),
    }),

    execute: async ({ eventId }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error('Missing userId in request context');
      const result = await calendarService.deleteEvent(userId, eventId);
      return result;
    },
  });
}
