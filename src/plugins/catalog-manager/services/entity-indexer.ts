import type { LoadedDocument } from "../../rag/ingestion/loader.js";
import type { ProcessResult } from "../../rag/ingestion/processor.js";

/**
 * Generic interface for converting business entities into RAG documents.
 * Each entity type (catalog, user, etc.) implements this to enable auto-indexing.
 */
export interface EntityIndexer<T = unknown> {
  readonly entityType: string;

  /** Build a deterministic source URI for idempotent indexing. */
  buildSource(entityId: string): string;

  /** Convert an entity to a LoadedDocument for the RAG pipeline. */
  toDocument(entity: T, orgId: string): LoadedDocument;

  /** Index a single entity. Removes stale doc if entity is inactive. */
  index(orgId: string, entityId: string): Promise<ProcessResult | null>;

  /** Remove an entity's document from the index. */
  remove(entityId: string): Promise<void>;

  /** Index all entities for a given org. */
  indexAll(orgId: string): Promise<{ indexed: number; failed: number }>;

  /** Index all entities across all orgs. */
  indexAllOrgs(): Promise<{ indexed: number; failed: number }>;
}
