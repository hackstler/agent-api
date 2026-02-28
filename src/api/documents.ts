import { Hono } from "hono";
import { db } from "../db/client.js";
import { documents, documentChunks } from "../db/schema.js";
import { eq, and, ilike, desc, type SQL } from "drizzle-orm";

const documentsRouter = new Hono();

/**
 * GET /documents?contentType=pdf&search=term
 * List documents filtered by the authenticated user's orgId.
 * Optionally filter by contentType and title search.
 */
documentsRouter.get("/", async (c) => {
  const user = c.get("user");
  const contentType = c.req.query("contentType");
  const search = c.req.query("search");

  const conditions: SQL[] = [];

  // Always filter by the authenticated user's org
  if (user?.orgId) {
    conditions.push(eq(documents.orgId, user.orgId));
  }

  if (contentType) {
    conditions.push(eq(documents.contentType, contentType as typeof documents.contentType.enumValues[number]));
  }

  if (search) {
    conditions.push(ilike(documents.title, `%${search}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      topicId: documents.topicId,
      title: documents.title,
      source: documents.source,
      contentType: documents.contentType,
      status: documents.status,
      chunkCount: documents.chunkCount,
      metadata: documents.metadata,
      createdAt: documents.createdAt,
      indexedAt: documents.indexedAt,
    })
    .from(documents)
    .where(where)
    .orderBy(desc(documents.createdAt));

  return c.json({ items: rows, total: rows.length });
});

/**
 * DELETE /documents/:id
 * Delete a document and all its chunks (cascade).
 * Only allows deleting documents from the authenticated user's org.
 */
documentsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const conditions: SQL[] = [eq(documents.id, id)];
  if (user?.orgId) {
    conditions.push(eq(documents.orgId, user.orgId));
  }

  const [deleted] = await db
    .delete(documents)
    .where(and(...conditions))
    .returning({ id: documents.id });

  if (!deleted) {
    return c.json({ error: "Document not found" }, 404);
  }

  return c.json({ id: deleted.id });
});

export default documentsRouter;
