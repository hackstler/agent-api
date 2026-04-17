import type { QuoteStrategy } from "./quote-strategy.interface.js";
import { RemoteQuoteStrategy } from "./remote.strategy.js";
import type { Organization } from "../../../domain/entities/index.js";
import { logger } from "../../../shared/logger.js";

export type { QuoteStrategy } from "./quote-strategy.interface.js";
export type {
  QuoteComparisonRow,
  QuoteCalculationResult,
  PdfColumnDef,
} from "./quote-strategy.interface.js";
export { RemoteQuoteStrategy } from "./remote.strategy.js";

/**
 * Registry that resolves a QuoteStrategy for an organization.
 *
 * After the decoupling: the agent-api is agnostic to any specific business
 * domain. There are NO local strategies — every org MUST provide its own
 * remote business function (businessLogicUrl + businessLogicApiKey).
 *
 * Adding a new business type:
 *   1. Deploy a business function implementing the 4-endpoint contract
 *      (/config, /catalog, /calculate, /pdf)
 *   2. Set organization.businessLogicUrl and businessLogicApiKey
 *   → resolveForOrg() loads the remote strategy and caches it
 */
export class QuoteStrategyRegistry {
  /** Cache of remote strategies by endpoint URL. Avoids re-fetching /config on every request. */
  private readonly remoteCache = new Map<string, RemoteQuoteStrategy>();

  /**
   * Resolve the QuoteStrategy for an organization.
   * Throws if the org has no businessLogicUrl/businessLogicApiKey configured —
   * the platform no longer ships any local strategy.
   */
  async resolveForOrg(org: Organization | null): Promise<QuoteStrategy> {
    if (!org?.businessLogicUrl || !org.businessLogicApiKey) {
      throw new Error(
        `Organization ${org?.orgId ?? "<unknown>"} has no business function configured. ` +
          "Set businessLogicUrl and businessLogicApiKey on the organization to enable quotes.",
      );
    }

    const cached = this.remoteCache.get(org.businessLogicUrl);
    if (cached) return cached;

    const remote = await RemoteQuoteStrategy.create(org.businessLogicUrl, org.businessLogicApiKey);
    this.remoteCache.set(org.businessLogicUrl, remote);
    logger.info(
      { orgId: org.orgId, businessType: remote.businessType, endpoint: org.businessLogicUrl },
      "Remote business function strategy loaded",
    );
    return remote;
  }

  /** Clear the remote strategy cache (useful for testing or config changes). */
  clearRemoteCache(): void {
    this.remoteCache.clear();
  }
}
