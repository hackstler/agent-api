import type { ActionExecutor, ActionExecutionContext, ActionResult } from "../../../domain/ports/action-executor.js";
import type { GmailApiService } from "../services/gmail-api.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import { logger } from "../../../shared/logger.js";

/**
 * Executes a confirmed "send-email" pending action.
 *
 * Resolves the attachment (if any) from the AttachmentStore,
 * then sends the email via GmailApiService.
 */
export class SendEmailExecutor implements ActionExecutor {
  readonly actionType = "send-email";

  constructor(
    private readonly gmailService: GmailApiService,
    private readonly attachmentStore: AttachmentStore,
  ) {}

  async execute(ctx: ActionExecutionContext): Promise<ActionResult> {
    const { to, subject, body, attachmentFilename } = ctx.action.payload as {
      to: string;
      subject: string;
      body: string;
      attachmentFilename?: string;
    };

    let attachment: { base64: string; mimetype: string; filename: string } | undefined;
    if (attachmentFilename) {
      const stored = await this.attachmentStore.retrieve(ctx.userId, attachmentFilename);
      if (!stored) {
        return {
          success: false,
          message: `El adjunto "${attachmentFilename}" ya no está disponible.`,
        };
      }
      attachment = stored;
    }

    const result = await this.gmailService.sendEmail(ctx.userId, to, subject, body, attachment);
    logger.info({ actionId: ctx.action.id, messageId: result.messageId, to }, "Email sent via HITL confirmation");

    return {
      success: true,
      message: `Email enviado correctamente a ${to}.`,
      data: { messageId: result.messageId },
    };
  }
}
