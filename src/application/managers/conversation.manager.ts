import type { Conversation, MessageMetadata, ToolCallSummary } from "../../domain/entities/index.js";
import type {
  ConversationRepository,
  ConversationWithMessages,
} from "../../domain/ports/repositories/conversation.repository.js";
import { NotFoundError } from "../../domain/errors/index.js";

export class ConversationManager {
  constructor(private readonly repo: ConversationRepository) {}

  async list(
    filters?: { userId?: string | undefined; limit?: number | undefined }
  ): Promise<Pick<Conversation, "id" | "title" | "createdAt" | "updatedAt">[]> {
    return this.repo.findAll(filters);
  }

  async create(data: {
    userId?: string | undefined;
    title?: string | undefined;
  }): Promise<Pick<Conversation, "id" | "title" | "createdAt">> {
    return this.repo.create({
      userId: data.userId,
      title: data.title ?? "New conversation",
    });
  }

  async getById(id: string): Promise<ConversationWithMessages> {
    const conv = await this.repo.findByIdWithMessages(id);
    if (!conv) throw new NotFoundError("Conversation", id);
    return conv;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundError("Conversation", id);
  }

  /** Resolve or create a conversation for a WhatsApp chatId. */
  async resolveOrCreateByTitle(title: string, userId: string): Promise<string> {
    const existing = await this.repo.findByTitle(title, userId);
    if (existing) return existing.id;

    const conv = await this.repo.create({ title, userId });
    return conv.id;
  }

  /**
   * Resolve or create a conversation by stable channel reference.
   * Unlike title-based lookup, channelRef survives title changes (e.g. from scheduleTitleSync).
   */
  async resolveOrCreateForChannel(channelRef: string, userId: string, title?: string): Promise<string> {
    const existing = await this.repo.findByChannelRef(channelRef, userId);
    if (existing) return existing.id;

    const conv = await this.repo.create({
      userId,
      title: title ?? "New conversation",
      config: { channelRef },
    });
    return conv.id;
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.repo.updateTitle(id, title);
  }

  /** Persist user + assistant messages and update conversation timestamp. */
  async persistMessages(
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
    metadata: { model?: string; retrievedChunks?: string[]; toolCalls?: ToolCallSummary[] },
  ): Promise<void> {
    await this.repo.persistMessages({ conversationId, userMessage, assistantMessage, metadata });
  }

  /** Persist only the user message. Used in streaming to save the query before the stream starts. */
  async persistUserMessage(conversationId: string, content: string): Promise<void> {
    await this.repo.persistUserMessage(conversationId, content);
  }

  /** Persist only the assistant response with metadata. Used after stream completes. */
  async persistAssistantMessage(
    conversationId: string,
    content: string,
    metadata?: MessageMetadata,
  ): Promise<void> {
    await this.repo.persistAssistantMessage(conversationId, content, metadata);
  }
}
