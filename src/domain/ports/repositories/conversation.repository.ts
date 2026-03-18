import type { Conversation, NewConversation, Message, ToolCallSummary, MessageMetadata } from "../../entities/index.js";

export interface ConversationWithMessages extends Conversation {
  messages: Pick<Message, "id" | "role" | "content" | "metadata" | "createdAt">[];
}

export interface PersistMessagesData {
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  metadata: { model?: string; retrievedChunks?: string[]; toolCalls?: ToolCallSummary[] };
}

export interface PersistSingleMessageData {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: MessageMetadata;
}

export interface ConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  findByIdWithMessages(id: string): Promise<ConversationWithMessages | null>;
  findAll(filters?: { userId?: string | undefined; limit?: number | undefined }): Promise<Pick<Conversation, "id" | "title" | "createdAt" | "updatedAt">[]>;
  findByTitle(title: string, userId: string): Promise<Pick<Conversation, "id"> | null>;
  findByChannelRef(channelRef: string, userId: string): Promise<Pick<Conversation, "id"> | null>;
  create(data: NewConversation): Promise<Pick<Conversation, "id" | "title" | "createdAt">>;
  delete(id: string): Promise<boolean>;
  updateTitle(id: string, title: string): Promise<void>;
  persistMessages(data: PersistMessagesData): Promise<void>;
  persistUserMessage(conversationId: string, content: string): Promise<void>;
  persistAssistantMessage(conversationId: string, content: string, metadata?: MessageMetadata): Promise<void>;
}
