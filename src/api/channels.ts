import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { whatsappSessions } from "../db/schema.js";

const channels = new Hono();

/**
 * GET /channels/whatsapp/status
 * Returns current WhatsApp session status for the authenticated user.
 */
channels.get("/whatsapp/status", async (c) => {
  const user = c.get("user");
  if (!user?.userId) {
    return c.json({ error: "Missing userId" }, 400);
  }

  const session = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.userId, user.userId),
  });

  if (!session) {
    return c.json({ data: { status: "not_enabled", phone: null } });
  }

  return c.json({
    data: {
      status: session.status,
      phone: session.phone,
      updatedAt: session.updatedAt.toISOString(),
    },
  });
});

/**
 * GET /channels/whatsapp/qr
 * Returns QR data if status is 'qr', otherwise 404.
 */
channels.get("/whatsapp/qr", async (c) => {
  const user = c.get("user");
  if (!user?.userId) {
    return c.json({ error: "Missing userId" }, 400);
  }

  const session = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.userId, user.userId),
  });

  if (!session || session.status !== "qr" || !session.qrData) {
    return c.json({ error: "No QR available" }, 404);
  }

  return c.json({ data: { qrData: session.qrData } });
});

/**
 * POST /channels/whatsapp/enable
 * Creates a pending WhatsApp session for the authenticated user (opt-in).
 * Returns 409 if the user already has a session.
 */
channels.post("/whatsapp/enable", async (c) => {
  const user = c.get("user");
  if (!user?.userId || !user?.orgId) {
    return c.json({ error: "Missing userId or orgId" }, 400);
  }

  const existing = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.userId, user.userId),
  });

  if (existing) {
    return c.json({ error: "Conflict", message: "WhatsApp session already exists for this user" }, 409);
  }

  const [session] = await db
    .insert(whatsappSessions)
    .values({ userId: user.userId, orgId: user.orgId, status: "pending" })
    .returning({
      id: whatsappSessions.id,
      userId: whatsappSessions.userId,
      orgId: whatsappSessions.orgId,
      status: whatsappSessions.status,
    });

  return c.json({ data: session }, 201);
});

/**
 * POST /channels/whatsapp/disconnect
 * Marks the session as disconnected.
 */
channels.post("/whatsapp/disconnect", async (c) => {
  const user = c.get("user");
  if (!user?.userId) {
    return c.json({ error: "Missing userId" }, 400);
  }

  const existing = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.userId, user.userId),
  });

  if (!existing) {
    return c.json({ error: "Not Found", message: "No WhatsApp session found" }, 404);
  }

  await db
    .update(whatsappSessions)
    .set({ status: "disconnected", qrData: null, phone: null, updatedAt: new Date() })
    .where(eq(whatsappSessions.userId, user.userId));

  return c.json({ data: { ok: true } });
});

export default channels;
