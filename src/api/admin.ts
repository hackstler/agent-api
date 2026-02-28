import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  users,
  documents,
  documentChunks,
  topics,
  whatsappSessions,
} from "../db/schema.js";
import { eq, ilike, and, sql, count, min } from "drizzle-orm";
import { hashPassword } from "./auth.js";
import type { TokenPayload } from "./middleware/auth.js";

const admin = new Hono();

// ── Users CRUD ────────────────────────────────────────────────────────────────

/**
 * GET /admin/users
 * List users with optional filtering by orgId and search term.
 */
admin.get("/users", async (c) => {
  const orgId = c.req.query("orgId");
  const search = c.req.query("search");

  const conditions = [];
  if (orgId) conditions.push(eq(users.orgId, orgId));
  if (search) conditions.push(ilike(users.email, `%${search}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      orgId: users.orgId,
      metadata: users.metadata,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(users.createdAt);

  const items = rows.map((row) => ({
    id: row.id,
    email: row.email,
    orgId: row.orgId,
    role: ((row.metadata as Record<string, unknown> | null)?.["role"] as string) ?? "user",
    createdAt: row.createdAt.toISOString(),
  }));

  return c.json({ items, total: items.length });
});

/**
 * POST /admin/users
 * Create a new user.
 */
admin.post("/users", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      username: z.string().min(3).max(50),
      password: z.string().min(8),
      orgId: z.string().min(1),
      role: z.enum(["admin", "user"]).default("user"),
    })
    .safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
  }

  const { username, password, orgId, role } = parsed.data;

  // Check duplicate username
  const existing = await db.query.users.findFirst({
    where: eq(users.email, username),
  });
  if (existing) {
    return c.json({ error: "Conflict", message: "Username already taken" }, 409);
  }

  const [user] = await db
    .insert(users)
    .values({
      email: username,
      orgId,
      metadata: { passwordHash: hashPassword(password), role },
    })
    .returning({
      id: users.id,
      email: users.email,
      orgId: users.orgId,
      createdAt: users.createdAt,
    });

  return c.json(
    {
      id: user!.id,
      email: user!.email,
      orgId: user!.orgId,
      role,
      createdAt: user!.createdAt.toISOString(),
    },
    201
  );
});

/**
 * DELETE /admin/users/:id
 * Delete a user. Prevents self-deletion.
 */
admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  const caller = c.get("user") as TokenPayload;

  if (caller.userId === id) {
    return c.json({ error: "Bad Request", message: "Cannot delete your own account" }, 400);
  }

  const deleted = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id });

  if (deleted.length === 0) {
    return c.json({ error: "Not Found", message: "User not found" }, 404);
  }

  return c.json({ ok: true });
});

// ── Organizations CRUD ────────────────────────────────────────────────────────

/**
 * GET /admin/organizations
 * List organizations aggregated from users table.
 */
admin.get("/organizations", async (c) => {
  // Aggregate user counts per org
  const userCounts = await db
    .select({
      orgId: users.orgId,
      userCount: count(users.id),
      createdAt: min(users.createdAt),
    })
    .from(users)
    .groupBy(users.orgId);

  // Aggregate document counts per org
  const docCounts = await db
    .select({
      orgId: documents.orgId,
      docCount: count(documents.id),
    })
    .from(documents)
    .groupBy(documents.orgId);

  const docCountMap = new Map(
    docCounts.map((d) => [d.orgId, Number(d.docCount)])
  );

  const items = userCounts.map((row) => ({
    orgId: row.orgId,
    userCount: Number(row.userCount),
    docCount: docCountMap.get(row.orgId) ?? 0,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  }));

  return c.json({ items });
});

/**
 * POST /admin/organizations
 * Create a new organization with an initial admin user.
 */
admin.post("/organizations", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      orgId: z.string().min(1).max(100),
      adminUsername: z.string().min(3).max(50),
      adminPassword: z.string().min(8),
    })
    .safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
  }

  const { orgId, adminUsername, adminPassword } = parsed.data;

  // Check orgId duplicado
  const existingOrg = await db.query.users.findFirst({
    where: eq(users.orgId, orgId),
  });
  if (existingOrg) {
    return c.json({ error: "Conflict", message: "Organization already exists" }, 409);
  }

  // Check username duplicado
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, adminUsername),
  });
  if (existingUser) {
    return c.json({ error: "Conflict", message: "Username already taken" }, 409);
  }

  const [adminUser] = await db
    .insert(users)
    .values({
      email: adminUsername,
      orgId,
      metadata: { passwordHash: hashPassword(adminPassword), role: "admin" },
    })
    .returning({
      id: users.id,
      email: users.email,
      orgId: users.orgId,
      createdAt: users.createdAt,
    });

  return c.json(
    {
      orgId,
      admin: {
        id: adminUser!.id,
        email: adminUser!.email,
        orgId: adminUser!.orgId,
        role: "admin",
        createdAt: adminUser!.createdAt.toISOString(),
      },
    },
    201
  );
});

/**
 * DELETE /admin/organizations/:orgId
 * Delete an organization and cascade-delete all related data.
 */
admin.delete("/organizations/:orgId", async (c) => {
  const orgId = c.req.param("orgId");
  const caller = c.get("user") as TokenPayload;

  if (caller.orgId === orgId) {
    return c.json(
      { error: "Bad Request", message: "Cannot delete your own organization" },
      400
    );
  }

  // Check org exists
  const orgUsers = await db.query.users.findFirst({
    where: eq(users.orgId, orgId),
  });
  if (!orgUsers) {
    return c.json({ error: "Not Found", message: "Organization not found" }, 404);
  }

  // Cascade delete in order:
  // 1. documents (documentChunks cascade via FK)
  await db.delete(documents).where(eq(documents.orgId, orgId));
  // 2. topics
  await db.delete(topics).where(eq(topics.orgId, orgId));
  // 3. whatsappSessions
  await db.delete(whatsappSessions).where(eq(whatsappSessions.orgId, orgId));
  // 4. users (conversations/messages cascade via FK)
  await db.delete(users).where(eq(users.orgId, orgId));

  return c.json({ ok: true });
});

export default admin;
