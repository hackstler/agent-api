import { tool } from "ai";
import { z } from "zod";
import type { GmailApiService } from "../services/gmail-api.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { getOrCreateExecutionContext } from "../../../agent/execution-context.js";

export interface SendEmailDeps {
  gmailService: GmailApiService;
  attachmentStore: AttachmentStore;
}

export function createSendEmailTool({ gmailService, attachmentStore }: SendEmailDeps) {
  return tool({
    description:
      `Send an email via the user's Gmail account, optionally with a file attachment.
Requires the user's Google account to be connected.
To attach a previously generated document (e.g., a PDF quote), provide its filename
exactly as shown when it was generated (e.g., "PRES-20260306-1234.pdf").`,
    inputSchema: z.object({
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
      attachmentFilename: z
        .string()
        .optional()
        .describe("Filename of a previously generated document to attach (e.g., PRES-20260306-1234.pdf)"),
    }),

    // ── FRENO: se evalúa ANTES de execute() ──────────────────────────
    // Si devuelve true, el SDK NO llama a execute() y retorna un
    // tool-approval-request. El ExecutionContext registra los detalles
    // para que el controller los pueda leer y emitir al frontend.
    needsApproval: async (input, { experimental_context, messages }) => {
      const requestId = getAgentContextValue(
        { experimental_context },
        "requestId",
      );
      if (!requestId) return false;

      // If the last user message contains "CONFIRMED" (coordinator enriched it),
      // this is a re-delegation after user confirmed → let execute() run.
      const lastUserMsg = [...(messages ?? [])].reverse().find((m) => m.role === "user");
      const lastText = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
      if (lastText.includes("CONFIRMED")) return false;

      const ctx = getOrCreateExecutionContext(requestId);
      const actionId = `sendEmail:${input.to}:${input.subject}`;

      // Already confirmed via POST /chat/confirm → let execute() run
      if (ctx.isConfirmed(actionId)) return false;

      // Registrar como pendiente — el controller lo leerá tras el stream
      ctx.registerPending({
        id: actionId,
        toolName: "sendEmail",
        input: input as Record<string, unknown>,
        description: `Enviar email a ${input.to} — asunto: "${input.subject}"${input.attachmentFilename ? ` — adjunto: ${input.attachmentFilename}` : ""}`,
        createdAt: Date.now(),
      });

      return true; // → SDK NO ejecuta execute()
    },

    // ── ACCIÓN: solo se llama si needsApproval devolvió false ────────
    execute: async ({ to, subject, body, attachmentFilename }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error("Missing userId in request context");

      let attachment: { base64: string; mimetype: string; filename: string } | undefined;

      if (attachmentFilename) {
        const stored = attachmentStore.retrieve(attachmentFilename);
        if (!stored) {
          throw new Error(`Attachment "${attachmentFilename}" not found. It may have expired or was never generated. Generate the document first, then try again.`);
        }
        attachment = stored;
      }

      const result = await gmailService.sendEmail(userId, to, subject, body, attachment);
      return { ...result, attachmentIncluded: !!attachment };
    },
  });
}
