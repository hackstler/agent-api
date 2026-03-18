import { tool } from "ai";
import { z } from "zod";
import type { CatalogService } from "../services/catalog.service.js";
import type { QuoteStrategy } from "../strategies/index.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface ListCatalogDeps {
  catalogService: CatalogService;
  strategy: QuoteStrategy;
}

export function createListCatalogTool({ catalogService, strategy }: ListCatalogDeps) {
  return tool({
    description: strategy.getListCatalogDescription(),

    inputSchema: z.object({}),

    execute: async (_input, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) {
        return {
          success: false,
          catalogName: "",
          grassTypes: [],
          note: "",
          error: "Missing orgId in request context",
        };
      }

      const catalogId = await catalogService.getActiveCatalogId(orgId);
      if (!catalogId) {
        return {
          success: false,
          catalogName: "",
          grassTypes: [],
          note: "",
          error: "No active catalog found for this organization",
        };
      }

      const items = await catalogService.getAllItems(catalogId);

      return {
        success: true,
        catalogName: orgId,
        grassTypes: items.map((i) => ({
          code: i.code,
          name: i.name,
          description: i.description,
          unit: i.unit,
        })),
        note: strategy.getListCatalogNote(),
      };
    },
  });
}
