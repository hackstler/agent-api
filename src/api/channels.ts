import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { whatsappSessions } from "../db/schema.js";

const channels = new Hono();

/**
 * GET /channels/whatsapp/status
 * Returns current WhatsApp session status for the user's org.
 */
channels.get("/whatsapp/status", async (c) => {
  const user = c.get("user");
  if (!user?.orgId) {
    return c.json({ error: "Missing orgId" }, 400);
  }

  const session = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.orgId, user.orgId),
  });

  if (!session) {
    return c.json({ data: { status: "disconnected", phone: null } });
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
  if (!user?.orgId) {
    return c.json({ error: "Missing orgId" }, 400);
  }

  const session = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.orgId, user.orgId),
  });

  if (!session || session.status !== "qr" || !session.qrData) {
    return c.json({ error: "No QR available" }, 404);
  }

  return c.json({ data: { qrData: session.qrData } });
});

/**
 * POST /channels/whatsapp/disconnect
 * Marks the session as disconnected.
 */
channels.post("/whatsapp/disconnect", async (c) => {
  const user = c.get("user");
  if (!user?.orgId) {
    return c.json({ error: "Missing orgId" }, 400);
  }

  await db
    .insert(whatsappSessions)
    .values({ orgId: user.orgId, status: "disconnected" })
    .onConflictDoUpdate({
      target: whatsappSessions.orgId,
      set: { status: "disconnected", qrData: null, phone: null, updatedAt: new Date() },
    });

  return c.json({ data: { ok: true } });
});

export default channels;
