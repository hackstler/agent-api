import type { MediaAttachment } from "./types.js";

/**
 * Temporary in-process store for media attachments sent in the current request.
 *
 * Problem: The coordinator (top-level agent) receives multimodal messages (images,
 * documents) but the delegation tool only passes a text `query` to sub-agents.
 * The image is lost before the specialized agent (e.g., expenses) can see it.
 *
 * Solution: Before running the coordinator, store the attachments keyed by
 * conversationId. The delegation tool retrieves and forwards them to the sub-agent.
 * After the first delegation the entry is consumed (one-shot).
 *
 * This is intentionally single-process (no Redis, no DB) because:
 * - Railway runs a single instance for our MVP
 * - Attachments are large binary data — passing them through a DB per-request would be slow
 * - The data is ephemeral: only needed for the duration of one agent turn
 */
const store = new Map<string, MediaAttachment[]>();

export function storePendingMedia(conversationId: string, attachments: MediaAttachment[]): void {
  store.set(conversationId, attachments);
}

/** Returns and removes the attachments for this conversation (one-shot). */
export function takePendingMedia(conversationId: string): MediaAttachment[] | undefined {
  const attachments = store.get(conversationId);
  store.delete(conversationId);
  return attachments;
}
