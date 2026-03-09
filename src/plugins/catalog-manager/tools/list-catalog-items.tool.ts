import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";

export function createListCatalogItemsTool(catalogManager: CatalogManager) {
  return createTool({
    id: "listCatalogItems",
    description:
      "List all items in a specific catalog. Returns code, name, description, price, unit, and category.",

    inputSchema: z.object({
      catalogId: z.string().describe("The catalog ID to list items from"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      data: z.array(
        z.object({
          id: z.string(),
          code: z.number(),
          name: z.string(),
          description: z.string().nullable(),
          category: z.string().nullable(),
          pricePerUnit: z.string(),
          unit: z.string(),
          isActive: z.boolean(),
        })
      ).optional(),
      error: z.string().optional(),
    }),

    execute: async ({ catalogId }, context) => {
      const orgId = context?.requestContext?.get("orgId") as string | undefined;
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        const items = await catalogManager.listItems(orgId, catalogId);
        return {
          success: true,
          data: items.map((i) => ({
            id: i.id,
            code: i.code,
            name: i.name,
            description: i.description,
            category: i.category,
            pricePerUnit: i.pricePerUnit,
            unit: i.unit,
            isActive: i.isActive,
          })),
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
