import type { ModelMessage } from "ai";
import type { MemoryManager } from "../application/managers/memory.manager.js";
import { logger } from "../shared/logger.js";

/**
 * Loads org memories and formats them as a system message to prepend to conversation history.
 * Returns an empty array if no memories are found or if memoryManager is not provided.
 */
export async function loadMemoryContext(
  memoryManager: MemoryManager | undefined,
  orgId: string,
  limit = 20,
): Promise<ModelMessage[]> {
  if (!memoryManager) return [];

  try {
    const memories = await memoryManager.listForOrg(orgId, limit);
    if (memories.length === 0) return [];

    const memoryText = memories
      .map((m) => `- [${m.type}] ${m.key}: ${m.content}`)
      .join("\n");

    return [
      {
        role: "system" as const,
        content: `== MEMORIAS GUARDADAS ==\nEstas son memorias guardadas de conversaciones anteriores con esta organización. Úsalas como contexto cuando sea relevante:\n${memoryText}`,
      },
    ];
  } catch (err) {
    logger.error({ err, orgId }, "Failed to load memory context");
    return [];
  }
}
