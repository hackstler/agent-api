import { Hono } from "hono";
import type { Context } from "hono";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import { QuoteStrategyRegistry, RemoteQuoteStrategy } from "../../plugins/quote/strategies/index.js";
import { logger } from "../../shared/logger.js";

/**
 * Catalog controller — READ-ONLY PROXY to the per-org remote business function.
 *
 * After the decoupling: the platform no longer stores catalog data. Each org
 * configures its own business function (businessLogicUrl + businessLogicApiKey),
 * and that function exposes the catalog via GET /catalog.
 *
 * The dashboard still wants to render a catalog browser, so we expose:
 *   - GET /admin/catalogs            → returns a single virtual catalog row
 *                                      that represents the remote endpoint.
 *   - GET /admin/catalogs/:id/items  → proxies the remote /catalog response.
 *
 * All write endpoints (POST/PATCH/DELETE) return 410 Gone — catalog mutation
 * happens in the business function deployment, not in agent-api.
 */
export function createCatalogController(orgRepo: OrganizationRepository): Hono {
  const router = new Hono();
  const registry = new QuoteStrategyRegistry();

  const VIRTUAL_CATALOG_ID = "remote";

  // ── List virtual catalogs ─────────────────────────────────────────────────
  router.get("/", async (c) => {
    const user = c.get("user");
    if (!user?.orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    try {
      const org = await orgRepo.findByOrgId(user.orgId);
      if (!org?.businessLogicUrl || !org.businessLogicApiKey) {
        return c.json({ items: [], total: 0 });
      }

      const strategy = await registry.resolveForOrg(org);
      const now = new Date().toISOString();

      const virtual = {
        id: VIRTUAL_CATALOG_ID,
        orgId: org.orgId,
        name: `Catálogo remoto · ${strategy.displayName}`,
        effectiveDate: now,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        orgName: org.name ?? null,
      };

      return c.json({ items: [virtual], total: 1 });
    } catch (err) {
      logger.warn({ err, orgId: user.orgId }, "[catalog.controller] list failed");
      return c.json({ items: [], total: 0 });
    }
  });

  // ── Get virtual catalog ───────────────────────────────────────────────────
  router.get("/:catalogId", async (c) => {
    const user = c.get("user");
    if (!user?.orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    const org = await orgRepo.findByOrgId(user.orgId);
    if (!org?.businessLogicUrl || !org.businessLogicApiKey) {
      return c.json({ error: "NotFound", message: "No business function configured for this org" }, 404);
    }

    const strategy = await registry.resolveForOrg(org);
    const now = new Date().toISOString();
    return c.json({
      id: VIRTUAL_CATALOG_ID,
      orgId: org.orgId,
      name: `Catálogo remoto · ${strategy.displayName}`,
      effectiveDate: now,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  // ── List items (proxy to remote /catalog) ─────────────────────────────────
  router.get("/:catalogId/items", async (c) => {
    const user = c.get("user");
    if (!user?.orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    const org = await orgRepo.findByOrgId(user.orgId);
    if (!org?.businessLogicUrl || !org.businessLogicApiKey) {
      return c.json({ items: [], total: 0 });
    }

    const strategy = await registry.resolveForOrg(org);
    if (!(strategy instanceof RemoteQuoteStrategy)) {
      return c.json({ items: [], total: 0 });
    }

    const remoteItems = await strategy.fetchCatalog();
    const now = new Date().toISOString();

    // Map remote catalog item shape → dashboard CatalogItemData shape.
    // Pricing is intentionally hidden here: it lives in the business function
    // and is computed dynamically per quote, so we don't expose static prices.
    const items = remoteItems.map((item, idx) => ({
      id: `remote:${item.code}`,
      catalogId: VIRTUAL_CATALOG_ID,
      code: Number.isFinite(Number(item.code)) ? Number(item.code) : idx + 1,
      name: item.name,
      description: item.description ?? null,
      category: item.category ?? null,
      pricePerUnit: "0.00",
      unit: item.unit ?? "u",
      sortOrder: idx,
      isActive: true,
      createdAt: now,
    }));

    return c.json({ items, total: items.length });
  });

  // ── All write endpoints retired ───────────────────────────────────────────
  const gone = (c: Context) =>
    c.json(
      {
        error: "Gone",
        message:
          "El catálogo se administra ahora en la lógica de negocio remota (businessLogicUrl). " +
          "Edita el catálogo desplegando la función de negocio de la organización.",
      },
      410,
    );

  router.post("/", gone);
  router.patch("/:catalogId", gone);
  router.delete("/:catalogId", gone);
  router.post("/:catalogId/activate", gone);
  router.post("/:catalogId/items", gone);
  router.patch("/:catalogId/items/:itemId", gone);
  router.delete("/:catalogId/items/:itemId", gone);
  router.post("/:catalogId/pricing/import", gone);

  return router;
}
