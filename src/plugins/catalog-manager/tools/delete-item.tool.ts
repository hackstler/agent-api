import { tool } from "ai";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export function createDeleteItemTool(catalogManager: CatalogManager) {
  return tool({
    description:
      "Delete an item from a catalog. The agent should confirm with the user before calling this.",

    inputSchema: z.object({
      catalogId: z.string().describe("The catalog ID the item belongs to"),
      itemId: z.string().describe("The item ID to delete"),
    }),

    execute: async ({ catalogId, itemId }, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        await catalogManager.deleteItem(orgId, catalogId, itemId);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
