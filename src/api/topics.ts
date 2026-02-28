import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { topics, documents } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const topicsRouter = new Hono();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
});

/**
 * GET /topics
 * List all topics for the authenticated user's org.
 */
topicsRouter.get("/", async (c) => {
  const orgId = c.get("user")?.orgId;

  if (!orgId) {
    return c.json({ error: "Unauthorized — no orgId in token" }, 401);
  }

  const rows = await db
    .select()
    .from(topics)
    .where(eq(topics.orgId, orgId))
    .orderBy(topics.name);

  return c.json({ items: rows, total: rows.length });
});

/**
 * POST /topics
 * Create a new topic in the authenticated user's org.
 */
topicsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const orgId = c.get("user")?.orgId;
  if (!orgId) {
    return c.json({ error: "Unauthorized — no orgId in token" }, 401);
  }

  const { name, description } = parsed.data;

  try {
    const [topic] = await db
      .insert(topics)
      .values({ orgId, name, description })
      .returning();
    return c.json(topic!, 201);
  } catch (err: unknown) {
    // PG unique violation code = '23505'
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code === "23505") {
      return c.json({ error: `Topic "${name}" already exists in this org` }, 409);
    }
    throw err;
  }
});

/**
 * PATCH /topics/:id
 * Update topic name or description. Only for topics in the user's org.
 */
topicsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const orgId = c.get("user")?.orgId;
  if (!orgId) {
    return c.json({ error: "Unauthorized — no orgId in token" }, 401);
  }

  const updates: Partial<{ name: string; description: string | null }> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const [updated] = await db
    .update(topics)
    .set(updates)
    .where(and(eq(topics.id, id), eq(topics.orgId, orgId)))
    .returning();

  if (!updated) {
    return c.json({ error: "Topic not found" }, 404);
  }

  return c.json(updated);
});

/**
 * DELETE /topics/:id
 * Delete a topic in the user's org. Documents have topicId set to NULL (CASCADE SET NULL).
 */
topicsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const orgId = c.get("user")?.orgId;
  if (!orgId) {
    return c.json({ error: "Unauthorized — no orgId in token" }, 401);
  }

  const [deleted] = await db
    .delete(topics)
    .where(and(eq(topics.id, id), eq(topics.orgId, orgId)))
    .returning({ id: topics.id });

  if (!deleted) {
    return c.json({ error: "Topic not found" }, 404);
  }

  return c.json({ id: deleted.id });
});

/**
 * GET /topics/:id/documents
 * List documents belonging to a topic (only if topic is in user's org).
 */
topicsRouter.get("/:id/documents", async (c) => {
  const id = c.req.param("id");
  const orgId = c.get("user")?.orgId;
  if (!orgId) {
    return c.json({ error: "Unauthorized — no orgId in token" }, 401);
  }

  const topic = await db.query.topics.findFirst({
    where: and(eq(topics.id, id), eq(topics.orgId, orgId)),
    columns: { id: true },
  });

  if (!topic) {
    return c.json({ error: "Topic not found" }, 404);
  }

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
      createdAt: documents.createdAt,
      indexedAt: documents.indexedAt,
    })
    .from(documents)
    .where(eq(documents.topicId, id))
    .orderBy(documents.createdAt);

  return c.json({ items: rows, total: rows.length });
});

export default topicsRouter;
