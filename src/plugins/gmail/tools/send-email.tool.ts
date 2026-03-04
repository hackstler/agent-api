import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GmailApiService } from "../services/gmail-api.service.js";

export interface SendEmailDeps {
  gmailService: GmailApiService;
}

export function createSendEmailTool({ gmailService }: SendEmailDeps) {
  return createTool({
    id: "sendEmail",
    description:
      "Send an email via the user's Gmail account. Requires the user's Google account to be connected.",
    inputSchema: z.object({
      userId: z
        .string()
        .describe("User ID sending the email (from system context)"),
      to: z
        .string()
        .email()
        .describe("Recipient email address"),
      subject: z
        .string()
        .min(1)
        .describe("Email subject line"),
      body: z
        .string()
        .min(1)
        .describe("Plain text email body"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      messageId: z.string(),
      threadId: z.string(),
    }),
    execute: async ({ userId, to, subject, body }) => {
      return gmailService.sendEmail(userId, to, subject, body);
    },
  });
}
