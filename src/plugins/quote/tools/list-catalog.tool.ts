import { tool } from "ai";
import { z } from "zod";
import type { CatalogService } from "../services/catalog.service.js";
import type { OrganizationRepository } from "../../../domain/ports/repositories/organization.repository.js";
import type { QuoteStrategyRegistry } from "../strategies/index.js";
import { RemoteQuoteStrategy } from "../strategies/remote.strategy.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface ListCatalogDeps {
  catalogService: CatalogService;
  organizationRepo: OrganizationRepository;
  strategyRegistry: QuoteStrategyRegistry;
}

export function createListCatalogTool({ catalogService, organizationRepo, strategyRegistry }: ListCatalogDeps) {
  const defaultStrategy = strategyRegistry.getDefault();

  return tool({
    description: defaultStrategy.getListCatalogDescription(),

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

      const [org, activeCatalog] = await Promise.all([
        organizationRepo.findByOrgId(orgId),
        catalogService.getActiveCatalog(orgId),
      ]);

      if (!activeCatalog) {
        return {
          success: false,
          catalogName: "",
          items: [],
          note: "",
          error: "No active catalog found for this organization",
        };
      }

      // Resolve strategy: remote (if org has businessLogicUrl) or local
      const activeStrategy = await strategyRegistry.resolveForOrg(org, activeCatalog.businessType);

      // Remote strategies fetch catalog from their own endpoint
      if (activeStrategy instanceof RemoteQuoteStrategy) {
        const remoteItems = await activeStrategy.fetchCatalog();
        return {
          success: true,
          catalogName: activeStrategy.displayName,
          items: remoteItems,
          note: activeStrategy.getListCatalogNote(),
        };
      }

      // Local strategies use the local catalog service
      const items = await catalogService.getAllItems(activeCatalog.id);

      return {
        success: true,
        catalogName: activeStrategy.displayName,
        items: items.map((i) => ({
          code: i.code,
          name: i.name,
          description: i.description,
          unit: i.unit,
        })),
        note: activeStrategy.getListCatalogNote(),
      };
    },
  });
}
