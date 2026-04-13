import { tool } from "ai";
import { z } from "zod";
import type { AgentTools } from "./types.js";
import type { MemoryManager } from "../application/managers/memory.manager.js";
import { getAgentContextValue } from "../application/agent-context.js";
import { logger } from "../shared/logger.js";

const MEMORY_TYPES = ["client_pref", "product_insight", "workflow_pattern", "user_pref"] as const;

/**
 * Creates agent memory tools (saveMemory, recallMemory, deleteMemory).
 * These tools are added directly to the coordinator, NOT through a plugin.
 */
export function createMemoryTools(memoryManager: MemoryManager): AgentTools {
  const saveMemory = tool({
    description: `Save a memory or learning for future conversations.
Use this to remember:
- Client preferences: "Cliente X siempre pide césped de 40mm", "Cliente Y quiere presupuestos sin IVA"
- Product insights: "El césped Premium tiene más demanda en verano"
- Workflow patterns: "Para pedidos grandes, siempre consultar stock antes"
- User preferences: "El vendedor Pedro prefiere respuestas breves"

Do NOT save trivial or one-time information. Only save learnings that will be useful in future conversations.
If a memory with the same key already exists, it will be updated.`,
    inputSchema: z.object({
      key: z.string().min(1).max(200).describe("Short descriptive key, e.g. 'cliente_juan_cesped_preferido'"),
      content: z.string().min(1).max(2000).describe("The memory content to save"),
      type: z.enum(MEMORY_TYPES).describe("Category: client_pref, product_insight, workflow_pattern, user_pref"),
    }),
    execute: async ({ key, content, type }, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) throw new Error("Missing orgId in context");
      const userId = getAgentContextValue({ experimental_context }, "userId");

      try {
        const memory = await memoryManager.save({
          orgId,
          userId: userId ?? null,
          type,
          key,
          content,
        });
        logger.info({ orgId, key, type }, "Memory saved");
        return { saved: true, id: memory.id, key: memory.key, message: `Memoria guardada: "${key}"` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        return { saved: false, error: msg };
      }
    },
  });

  const recallMemory = tool({
    description: `Search for previously saved memories about a topic, client, or product.
Use this when:
- You need to remember a client's preferences
- You want to check if there are saved insights about a product or topic
- You want to understand past patterns or learnings

The search matches keywords against memory keys and content.`,
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe("Keyword or topic to search for in saved memories"),
      type: z.enum(MEMORY_TYPES).optional().describe("Optional: filter by memory type"),
    }),
    execute: async ({ query, type }, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) throw new Error("Missing orgId in context");

      const memories = type
        ? await memoryManager.listByType(orgId, type, 20)
        : await memoryManager.search(orgId, query, 20);

      return {
        memories: memories.map((m) => ({
          id: m.id,
          type: m.type,
          key: m.key,
          content: m.content,
          updatedAt: m.updatedAt.toISOString(),
        })),
        count: memories.length,
      };
    },
  });

  const deleteMemory = tool({
    description: `Delete an outdated or incorrect memory by its ID.
Use this when a previously saved memory is no longer accurate or relevant.`,
    inputSchema: z.object({
      id: z.string().uuid().describe("The memory ID to delete (returned by recallMemory)"),
    }),
    execute: async ({ id }) => {
      const deleted = await memoryManager.delete(id);
      return { deleted, message: deleted ? "Memoria eliminada" : "Memoria no encontrada" };
    },
  });

  return { saveMemory, recallMemory, deleteMemory };
}
