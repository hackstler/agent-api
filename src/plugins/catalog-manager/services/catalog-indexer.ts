import type { Catalog, CatalogItem } from "../../../domain/entities/index.js";
import type { CatalogRepository } from "../../../domain/ports/repositories/catalog.repository.js";
import type { LoadedDocument } from "../../rag/ingestion/loader.js";
import type { ProcessResult } from "../../rag/ingestion/processor.js";
import { processDocument } from "../../rag/ingestion/processor.js";
import { db } from "../../../infrastructure/db/client.js";
import { documents } from "../../../infrastructure/db/schema.js";
import { eq } from "drizzle-orm";
import type { EntityIndexer } from "./entity-indexer.js";

interface CatalogWithItems extends Catalog {
  items: CatalogItem[];
}

export class CatalogIndexer implements EntityIndexer<CatalogWithItems> {
  readonly entityType = "catalog";

  constructor(private readonly catalogRepo: CatalogRepository) {}

  buildSource(catalogId: string): string {
    return `entity://catalog/${catalogId}`;
  }

  toDocument(catalog: CatalogWithItems, _orgId: string): LoadedDocument {
    const lines: string[] = [];

    lines.push(`# Catalogo: ${catalog.name}`);
    lines.push("");
    lines.push(`- **Fecha efectiva**: ${catalog.effectiveDate.toLocaleDateString("es-ES")}`);
    lines.push(`- **Estado**: ${catalog.isActive ? "Activo" : "Inactivo"}`);
    lines.push(`- **Total productos**: ${catalog.items.length}`);
    lines.push("");

    // Group items by category
    const byCategory = new Map<string, CatalogItem[]>();
    for (const item of catalog.items) {
      const cat = item.category ?? "Sin categoria";
      const list = byCategory.get(cat) ?? [];
      list.push(item);
      byCategory.set(cat, list);
    }

    for (const [category, items] of byCategory) {
      lines.push(`## ${category}`);
      lines.push("");
      lines.push("| Codigo | Nombre | Descripcion | Precio | Unidad |");
      lines.push("|--------|--------|-------------|--------|--------|");
      for (const item of items) {
        const desc = item.description?.replace(/\|/g, "/") ?? "";
        lines.push(
          `| ${item.code} | ${item.name} | ${desc} | ${item.pricePerUnit} | ${item.unit} |`
        );
      }
      lines.push("");
    }

    const content = lines.join("\n");

    return {
      content,
      metadata: {
        title: `Catalogo: ${catalog.name}`,
        source: this.buildSource(catalog.id),
        contentType: "entity",
        size: Buffer.byteLength(content, "utf-8"),
      },
    };
  }

  async index(orgId: string, catalogId: string): Promise<ProcessResult | null> {
    const catalog = await this.catalogRepo.findByOrgAndId(orgId, catalogId);
    if (!catalog) {
      console.warn(`[catalog-indexer] catalog ${catalogId} not found for org ${orgId}`);
      return null;
    }

    // Only index active catalogs
    if (!catalog.isActive) {
      await this.remove(catalogId);
      return null;
    }

    const items = await this.catalogRepo.findItemsByCatalog(catalogId);
    const catalogWithItems: CatalogWithItems = { ...catalog, items };
    const loaded = this.toDocument(catalogWithItems, orgId);

    console.log(`[catalog-indexer] indexing catalog "${catalog.name}" (${items.length} items)`);
    return processDocument(loaded, orgId);
  }

  async remove(catalogId: string): Promise<void> {
    const source = this.buildSource(catalogId);
    const existing = await db.query.documents.findFirst({
      where: eq(documents.source, source),
      columns: { id: true },
    });
    if (existing) {
      await db.delete(documents).where(eq(documents.id, existing.id));
      console.log(`[catalog-indexer] removed index for catalog ${catalogId}`);
    }
  }

  async indexAll(orgId: string): Promise<{ indexed: number; failed: number }> {
    const catalogs = await this.catalogRepo.findByOrgId(orgId);
    let indexed = 0;
    let failed = 0;

    for (const catalog of catalogs) {
      if (!catalog.isActive) continue;
      try {
        const result = await this.index(orgId, catalog.id);
        if (result?.status === "indexed") indexed++;
        else if (result?.status === "failed") failed++;
      } catch (err) {
        console.error(`[catalog-indexer] failed to index catalog ${catalog.id}:`, err);
        failed++;
      }
    }

    return { indexed, failed };
  }

  async indexAllOrgs(): Promise<{ indexed: number; failed: number }> {
    const allCatalogs = await this.catalogRepo.findAll();

    // Collect unique orgIds
    const orgIds = [...new Set(allCatalogs.map((c) => c.orgId))];
    let totalIndexed = 0;
    let totalFailed = 0;

    for (const orgId of orgIds) {
      const { indexed, failed } = await this.indexAll(orgId);
      totalIndexed += indexed;
      totalFailed += failed;
    }

    return { indexed: totalIndexed, failed: totalFailed };
  }
}
