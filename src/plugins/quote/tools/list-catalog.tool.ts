import { tool } from "ai";
import { z } from "zod";
import type { OrganizationRepository } from "../../../domain/ports/repositories/organization.repository.js";
import type { QuoteStrategyRegistry } from "../strategies/index.js";
import { RemoteQuoteStrategy } from "../strategies/remote.strategy.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface ListCatalogDeps {
  organizationRepo: OrganizationRepository;
  strategyRegistry: QuoteStrategyRegistry;
}

export function createListCatalogTool({ organizationRepo, strategyRegistry }: ListCatalogDeps) {
  return tool({
    description:
      "Lista los productos disponibles en el catálogo de la organización. " +
      "Úsalo cuando el usuario pregunte qué productos hay, qué precios manejas, " +
      "o necesites mostrar opciones antes de calcular un presupuesto.",

    inputSchema: z.object({}),

    execute: async (_input, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) {
        return {
          success: false,
          catalogName: "",
          items: [],
          note: "",
          error: "Missing orgId in request context",
        };
      }

      const org = await organizationRepo.findByOrgId(orgId);

      let activeStrategy;
      try {
        activeStrategy = await strategyRegistry.resolveForOrg(org);
      } catch (err) {
        return {
          success: false,
          catalogName: "",
          items: [],
          note: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Strategy is always remote in this build — fetchCatalog lives only there
      if (!(activeStrategy instanceof RemoteQuoteStrategy)) {
        return {
          success: false,
          catalogName: "",
          items: [],
          note: "",
          error: "Active strategy does not support catalog listing",
        };
      }

      const remoteItems = await activeStrategy.fetchCatalog();
      return {
        success: true,
        catalogName: activeStrategy.displayName,
        items: remoteItems,
        note: activeStrategy.getListCatalogNote(),
      };
    },
  });
}
