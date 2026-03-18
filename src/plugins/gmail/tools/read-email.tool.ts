import { tool } from "ai";
import { z } from "zod";
import type { GmailApiService } from "../services/gmail-api.service.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface ReadEmailDeps {
  gmailService: GmailApiService;
}

export function createReadEmailTool({ gmailService }: ReadEmailDeps) {
  return tool({
    description:
      "Read the full content of a specific email by its message ID. Returns subject, sender, recipient, date, body text, and labels.",
    inputSchema: z.object({
      messageId: z
        .string()
        .describe("The Gmail message ID to read"),
    }),
    execute: async ({ messageId }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error('Missing userId in request context');
      return gmailService.readEmail(userId, messageId);
    },
  });
}
