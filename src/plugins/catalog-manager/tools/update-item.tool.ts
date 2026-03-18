import { tool } from "ai";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export function createUpdateItemTool(catalogManager: CatalogManager) {
  return tool({
    description:
      "Update an existing catalog item. Only provide the fields that need to change.",

    inputSchema: z.object({
      catalogId: z.string().describe("The catalog ID the item belongs to"),
      itemId: z.string().describe("The item ID to update"),
      name: z.string().optional().describe("New product name"),
      pricePerUnit: z.string().optional().describe("New price per unit"),
      unit: z.string().optional().describe("New unit of measure"),
      description: z.string().optional().describe("New description"),
      category: z.string().optional().describe("New category"),
    }),

    execute: async ({ catalogId, itemId, name, pricePerUnit, unit, description, category }, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        const item = await catalogManager.updateItem(orgId, catalogId, itemId, {
          name,
          pricePerUnit,
          unit,
          description,
          category,
        });
        return {
          success: true,
          data: {
            id: item.id,
            code: item.code,
            name: item.name,
            pricePerUnit: item.pricePerUnit,
            unit: item.unit,
          },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
