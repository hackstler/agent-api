import type { ModelMessage } from "ai";
import type { ConversationManager } from "../application/managers/conversation.manager.js";
import type { ToolCallSummary, Message } from "../domain/entities/index.js";
import { ragConfig } from "../plugins/rag/config/rag.config.js";

/**
 * Session gap threshold: if more than 2 hours pass between messages,
 * they belong to different sessions.
 */
const SESSION_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Max number of old sessions to include as compacted summaries. */
const MAX_OLD_SESSIONS = 3;

/** Max chars of user message content to include in compacted summaries. */
const USER_MSG_TRUNCATE = 80;

/** A message with the fields we need from the DB. */
type HistoryMessage = Pick<Message, "id" | "role" | "content" | "metadata" | "createdAt">;

/**
 * A group of messages that belong to the same interaction session.
 */
interface Session {
  messages: HistoryMessage[];
  startedAt: Date;
}

/**
 * Load conversation history with session-aware compaction.
 *
 * Strategy (inspired by Claude Code's context management):
 *
 * 1. Split all messages into "sessions" based on time gaps (>2h = new session)
 * 2. **Current session** (the most recent): load messages in FULL
 * 3. **Previous sessions**: compact into brief summaries using persisted toolCalls metadata
 *    - Only user messages are included (truncated to 80 chars)
 *    - Assistant messages are replaced by their tool summaries
 *    - Max 3 previous sessions are included
 *
 * This prevents the LLM from confusing old context with the current request,
 * which was causing action contamination in long-lived WhatsApp conversations.
 *
 * Default window size comes from ragConfig.windowSize (currently 10).
 */
export async function loadConversationHistory(
  convManager: ConversationManager,
  conversationId: string,
  windowSize = ragConfig.windowSize,
): Promise<ModelMessage[]> {
  try {
    const conv = await convManager.getById(conversationId);
    const allMessages = conv.messages ?? [];

    if (allMessages.length === 0) return [];

    // Split messages into sessions based on time gaps
    const sessions = splitIntoSessions(allMessages);

    if (sessions.length <= 1) {
      // Single session — no compaction needed, use the simple path
      const recent = allMessages.slice(-windowSize);
      return recent.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: enrichWithToolContext(m.role, m.content, m.metadata?.toolCalls),
      }));
    }

    // Multiple sessions — compact old ones, keep current one full
    const currentSession = sessions[sessions.length - 1]!;
    const oldSessions = sessions.slice(0, -1).slice(-MAX_OLD_SESSIONS); // last N old sessions

    const result: ModelMessage[] = [];

    // 1. Compact old sessions into brief summaries
    for (const session of oldSessions) {
      const summary = compactSession(session);
      if (summary) {
        result.push({
          role: "system" as const,
          content: summary,
        });
      }
    }

    // 2. Add session boundary marker
    const currentStart = currentSession.startedAt;
    const date = currentStart.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Madrid",
    });
    result.push({
      role: "system" as const,
      content: `--- Sesión actual (${date}) — responde SOLO al último mensaje del usuario ---`,
    });

    // 3. Load current session messages in full (capped by windowSize)
    const currentMessages = currentSession.messages.slice(-windowSize);
    for (const m of currentMessages) {
      result.push({
        role: m.role as "user" | "assistant" | "system",
        content: enrichWithToolContext(m.role, m.content, m.metadata?.toolCalls),
      });
    }

    return result;
  } catch {
    // Conversation may not exist yet
    return [];
  }
}

/**
 * Split a chronologically ordered array of messages into sessions.
 * A new session starts when there's a gap of >SESSION_GAP_MS between messages.
 */
function splitIntoSessions(messages: HistoryMessage[]): Session[] {
  if (messages.length === 0) return [];

  const sessions: Session[] = [];
  let current: Session = {
    messages: [messages[0]!],
    startedAt: messages[0]!.createdAt,
  };

  for (let i = 1; i < messages.length; i++) {
    const m = messages[i]!;
    const prev = messages[i - 1]!;

    const gap = m.createdAt.getTime() - prev.createdAt.getTime();

    if (gap > SESSION_GAP_MS) {
      sessions.push(current);
      current = { messages: [m], startedAt: m.createdAt };
    } else {
      current.messages.push(m);
    }
  }

  sessions.push(current);
  return sessions;
}

/**
 * Compact an old session into a brief summary string.
 *
 * Format:
 * ```
 * [Sesión anterior — lunes, 25 de marzo, 11:03]
 * - Usuario: "vale toma nota de lo que son las traviesas, basicamente un tipo de d..."
 * - → Nota guardada
 * - Usuario: "necesito un presupuesto para Carlos Ruiz..."
 * - → Presupuesto: quote_carlos_ruiz.pdf
 * ```
 *
 * Rules:
 * - User messages: truncated to USER_MSG_TRUNCATE chars
 * - Assistant messages: replaced by tool summaries only (no full text)
 * - System messages: omitted entirely
 */
function compactSession(session: Session): string | null {
  const lines: string[] = [];

  const date = session.startedAt.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });

  lines.push(`[Sesión anterior — ${date}]`);

  let hasContent = false;

  for (const m of session.messages) {
    if (m.role === "user") {
      const truncated = m.content.length > USER_MSG_TRUNCATE
        ? m.content.slice(0, USER_MSG_TRUNCATE) + "..."
        : m.content;
      lines.push(`- Usuario: "${truncated}"`);
      hasContent = true;
    } else if (m.role === "assistant") {
      // Only include tool summaries, skip the full assistant text
      const toolCalls = m.metadata?.toolCalls;
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          lines.push(`- → ${tc.summary}`);
        }
        hasContent = true;
      }
      // If no tool calls, omit the assistant message entirely
    }
    // System messages: omitted
  }

  return hasContent ? lines.join("\n") : null;
}

/**
 * For assistant messages that used tools, prepend a brief summary so the LLM
 * has continuity across turns without re-calling the same tools.
 */
function enrichWithToolContext(
  role: string,
  content: string,
  toolCalls?: ToolCallSummary[],
): string {
  if (role !== "assistant" || !toolCalls?.length) return content;

  const summary = toolCalls.map((tc) => tc.summary).join("; ");
  return `[Herramientas: ${summary}]\n${content}`;
}
