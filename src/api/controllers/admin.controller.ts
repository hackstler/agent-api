import { Hono } from "hono";
import { z } from "zod";
import type { UserManager } from "../../application/managers/user.manager.js";
import type { OrganizationManager } from "../../application/managers/organization.manager.js";
import type { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";
import type { AuthConfig } from "../../config/auth.config.js";
import type { TokenPayload } from "../middleware/auth.js";

const listUsersValidator = z.object({
  orgId: z.string().optional(),
  search: z.string().optional(),
});

const createUserValidator = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  orgId: z.string().min(1),
  role: z.enum(["admin", "user", "super_admin"]).default("user"),
});

const inviteUserValidator = z.object({
  email: z.string().email().max(255),
  orgId: z.string().min(1),
  role: z.enum(["admin", "user", "super_admin"]).default("user"),
});

const createOrgValidator = z.object({
  orgId: z.string().min(1).max(100),
  adminUsername: z.string().min(3).max(50),
  adminPassword: z.string().min(8),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(50).optional(),
  name: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional(),
  nif: z.string().max(50).optional(),
  logo: z.string().max(2_000_000).optional(),
  vatRate: z.number().min(0).max(1).optional(),
  currency: z.string().max(10).optional(),
});

const updateOrgValidator = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(50).optional().nullable(),
  name: z.string().max(200).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  nif: z.string().max(50).optional().nullable(),
  logo: z.string().max(2_000_000).optional().nullable(),
  vatRate: z.number().min(0).max(1).optional().nullable(),
  currency: z.string().max(10).optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

function isSuperAdmin(caller: TokenPayload): boolean {
  return caller.role === "super_admin";
}

export function createAdminController(
  userManager: UserManager,
  orgManager: OrganizationManager,
  authConfig: AuthConfig,
  waManager: WhatsAppManager,
): Hono {
  const router = new Hono();

  // ── Users CRUD ──────────────────────────────────────────────────────────────

  router.get("/users", async (c) => {
    const caller = c.get("user") as TokenPayload;
    const raw = listUsersValidator.parse(c.req.query());
    const filters: { orgId?: string; search?: string } = {};

    if (isSuperAdmin(caller)) {
      // super_admin can filter by any orgId or see all
      if (raw.orgId) filters.orgId = raw.orgId;
    } else {
      // org-scoped admin — always filter by own org
      filters.orgId = caller.orgId;
    }
    if (raw.search) filters.search = raw.search;

    const items = await userManager.listAll(filters);
    return c.json({ items, total: items.length });
  });

  router.post("/users", async (c) => {
    const caller = c.get("user") as TokenPayload;
    const body = await c.req.json().catch(() => null);

    // Firebase strategy: invite by email (no password)
    if (authConfig.strategy === "firebase") {
      const parsed = inviteUserValidator.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
      }
      // org-scoped admin can only invite to own org
      if (!isSuperAdmin(caller) && parsed.data.orgId !== caller.orgId) {
        return c.json({ error: "Forbidden", message: "Cannot invite users to other organizations" }, 403);
      }
      // Only super_admin can create super_admin users
      if (parsed.data.role === "super_admin" && !isSuperAdmin(caller)) {
        return c.json({ error: "Forbidden", message: "Only super_admin can assign super_admin role" }, 403);
      }
      const user = await userManager.invite(parsed.data);
      return c.json(user, 201);
    }

    // Password strategy: create with username + password
    const parsed = createUserValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
    }
    // org-scoped admin can only create users in own org
    if (!isSuperAdmin(caller) && parsed.data.orgId !== caller.orgId) {
      return c.json({ error: "Forbidden", message: "Cannot create users in other organizations" }, 403);
    }
    // Only super_admin can create super_admin users
    if (parsed.data.role === "super_admin" && !isSuperAdmin(caller)) {
      return c.json({ error: "Forbidden", message: "Only super_admin can assign super_admin role" }, 403);
    }
    const user = await userManager.create(parsed.data);
    return c.json(user, 201);
  });

  router.delete("/users/:id", async (c) => {
    const id = c.req.param("id");
    const caller = c.get("user") as TokenPayload;
    await userManager.delete(id, caller.userId);
    return c.json({ ok: true });
  });

  // ── Organizations CRUD ──────────────────────────────────────────────────────

  router.get("/organizations", async (c) => {
    const caller = c.get("user") as TokenPayload;
    if (isSuperAdmin(caller)) {
      const items = await orgManager.list();
      return c.json({ items });
    }
    // org-scoped admin: only own org
    try {
      const org = await orgManager.getByOrgId(caller.orgId);
      return c.json({ items: [org] });
    } catch {
      return c.json({ items: [] });
    }
  });

  router.get("/organizations/:orgId", async (c) => {
    const orgId = c.req.param("orgId");
    const caller = c.get("user") as TokenPayload;
    // org-scoped admin can only view own org
    if (!isSuperAdmin(caller) && orgId !== caller.orgId) {
      return c.json({ error: "Forbidden", message: "Cannot view other organizations" }, 403);
    }
    const org = await orgManager.getByOrgId(orgId);
    return c.json(org);
  });

  router.post("/organizations", async (c) => {
    const caller = c.get("user") as TokenPayload;
    if (!isSuperAdmin(caller)) {
      return c.json({ error: "Forbidden", message: "Only super_admin can create organizations" }, 403);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = createOrgValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
    }
    const { vatRate, ...rest } = parsed.data;
    const result = await orgManager.create({
      ...rest,
      vatRate: vatRate != null ? String(vatRate) : undefined,
    });
    return c.json(result, 201);
  });

  router.put("/organizations/:orgId", async (c) => {
    const orgId = c.req.param("orgId");
    const caller = c.get("user") as TokenPayload;
    // org-scoped admin can only update own org
    if (!isSuperAdmin(caller) && orgId !== caller.orgId) {
      return c.json({ error: "Forbidden", message: "Cannot update other organizations" }, 403);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = updateOrgValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
    }
    const { vatRate, ...rest } = parsed.data;
    const data = {
      ...rest,
      ...(vatRate !== undefined ? { vatRate: vatRate != null ? String(vatRate) : null } : {}),
    };
    const org = await orgManager.update(orgId, caller.orgId, data);
    return c.json(org);
  });

  router.delete("/organizations/:orgId", async (c) => {
    const caller = c.get("user") as TokenPayload;
    if (!isSuperAdmin(caller)) {
      return c.json({ error: "Forbidden", message: "Only super_admin can delete organizations" }, 403);
    }
    const orgId = c.req.param("orgId");
    await orgManager.delete(orgId, caller.orgId);
    return c.json({ ok: true });
  });

  // ── WhatsApp Sessions (admin) ─────────────────────────────────────────────

  router.get("/whatsapp/sessions", async (c) => {
    const caller = c.get("user") as TokenPayload;
    const items = isSuperAdmin(caller)
      ? await waManager.listAllSessions()
      : await waManager.listSessionsByOrg(caller.orgId);
    return c.json({ items, total: items.length });
  });

  router.post("/whatsapp/sessions/:userId/revoke", async (c) => {
    const userId = c.req.param("userId");
    await waManager.disconnectForUser(userId);
    return c.json({ ok: true });
  });

  return router;
}
