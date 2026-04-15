import type { QuoteStrategy } from "./quote-strategy.interface.js";
import { GrassQuoteStrategy } from "./grass.strategy.js";
import { RemoteQuoteStrategy } from "./remote.strategy.js";
import type { Organization } from "../../../domain/entities/index.js";
import { logger } from "../../../shared/logger.js";

export type { QuoteStrategy } from "./quote-strategy.interface.js";
export type {
  QuoteComparisonRow,
  QuoteCalculationResult,
  PdfColumnDef,
} from "./quote-strategy.interface.js";
export { GrassQuoteStrategy } from "./grass.strategy.js";
export { RemoteQuoteStrategy } from "./remote.strategy.js";

/**
 * Registry that maps businessType → QuoteStrategy.
 *
 * Strategies can be:
 *   - **Local**: registered at startup (e.g. GrassQuoteStrategy)
 *   - **Remote**: resolved per-org when the org has a businessLogicUrl configured
 *
 * Adding a new local business type:
 *   1. Create a new class implementing QuoteStrategy (e.g. CleaningStrategy)
 *   2. Register it here with register()
 *   3. Create a catalog with businessType = "cleaning"
 *
 * Adding a remote business type:
 *   1. Deploy a business function implementing the 4-endpoint contract
 *   2. Set organization.businessLogicUrl and businessLogicApiKey
 *   → resolveForOrg() auto-creates a RemoteQuoteStrategy
 */
export class QuoteStrategyRegistry {
  private readonly strategies = new Map<string, QuoteStrategy>();

  /** Cache of remote strategies by endpoint URL. Avoids re-fetching /config on every request. */
  private readonly remoteCache = new Map<string, RemoteQuoteStrategy>();

  /** The default strategy used when a catalog has no businessType or the type is unknown. */
  private defaultStrategy: QuoteStrategy;

  constructor() {
    // Grass is the default — backward compatible with existing catalogs
    const grass = new GrassQuoteStrategy();
    this.defaultStrategy = grass;
    this.strategies.set(grass.businessType, grass);
  }

  register(strategy: QuoteStrategy): void {
    this.strategies.set(strategy.businessType, strategy);
  }

  /** Resolve a local strategy by businessType. Falls back to default. */
  resolve(businessType: string | null | undefined): QuoteStrategy {
    if (!businessType) return this.defaultStrategy;
    return this.strategies.get(businessType) ?? this.defaultStrategy;
  }

  /**
   * Resolve strategy for an organization.
   * If the org has a businessLogicUrl → returns a RemoteQuoteStrategy (cached).
   * Otherwise → falls back to local resolution by catalog businessType.
   */
  async resolveForOrg(
    org: Organization | null,
    catalogBusinessType?: string | null,
  ): Promise<QuoteStrategy> {
    // Remote strategy: org has external business function configured
    if (org?.businessLogicUrl && org.businessLogicApiKey) {
      const cached = this.remoteCache.get(org.businessLogicUrl);
      if (cached) return cached;

      try {
        const remote = await RemoteQuoteStrategy.create(org.businessLogicUrl, org.businessLogicApiKey);
        this.remoteCache.set(org.businessLogicUrl, remote);
        logger.info(
          { orgId: org.orgId, businessType: remote.businessType, endpoint: org.businessLogicUrl },
          "Remote business function strategy loaded",
        );
        return remote;
      } catch (err) {
        logger.error(
          { err, orgId: org.orgId, endpoint: org.businessLogicUrl },
          "Failed to load remote business function — falling back to local strategy",
        );
        // Fall through to local resolution
      }
    }

    // Local strategy: resolve from catalog's businessType
    return this.resolve(catalogBusinessType);
  }

  getDefault(): QuoteStrategy {
    return this.defaultStrategy;
  }

  getAllTypes(): string[] {
    return [...this.strategies.keys()];
  }

  /** Clear the remote strategy cache (useful for testing or config changes). */
  clearRemoteCache(): void {
    this.remoteCache.clear();
  }
}
