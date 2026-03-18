import { tool } from "ai";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export function createAddItemTool(catalogManager: CatalogManager) {
  return tool({
    description:
      "Add a new item/product to a catalog. Code is auto-generated if not provided.",

    inputSchema: z.object({
      catalogId: z.string().describe("The catalog ID to add the item to"),
      name: z.string().describe("Product name"),
      pricePerUnit: z.string().describe("Price per unit (e.g. '15.50')"),
      unit: z.string().describe("Unit of measure (e.g. 'm2', 'ud', 'ml')"),
      description: z.string().optional().describe("Product description"),
      category: z.string().optional().describe("Product category"),
    }),

    execute: async ({ catalogId, name, pricePerUnit, unit, description, category }, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        const item = await catalogManager.createItem(orgId, catalogId, {
          name,
          pricePerUnit,
          unit,
          description: description ?? null,
          category: category ?? null,
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
