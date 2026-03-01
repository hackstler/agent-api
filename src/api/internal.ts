import { Hono } from "hono";
import { z } from "zod";
import { eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { whatsappSessions, conversations, users } from "../db/schema.js";
import { ragAgent } from "../agent/index.js";
import { ragConfig } from "../config/rag.config.js";
import { extractSources } from "./helpers/extract-sources.js";
import { persistMessages } from "./helpers/persist-messages.js";
import { formatForWhatsApp, buildSourcesFooter } from "./helpers/format-whatsapp.js";

const internal = new Hono();

// ── Schemas ────────────────────────────────────────────────────────────────────

const qrSchema = z.object({
  qrData: z.string().min(1),
  userId: z.string().uuid(),
});

const statusSchema = z.object({
  status: z.enum(["connected", "disconnected"]),
  phone: z.string().optional(),
  userId: z.string().uuid(),
});

const messageSchema = z.object({
  messageId: z.string().min(1),
  body: z.string().min(1).max(10_000),
  chatId: z.string().min(1),
  userId: z.string().uuid(),
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Look up a user by ID and return their orgId.
 * Returns null if user not found.
 */
async function resolveOrgIdFromUser(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { orgId: true },
  });
  return user?.orgId ?? null;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * GET /internal/whatsapp/sessions
 * Returns all active (non-disconnected) WhatsApp sessions with userId and orgId.
 */
internal.get("/whatsapp/sessions", async (c) => {
  const rows = await db
    .select({ userId: whatsappSessions.userId, orgId: whatsappSessions.orgId })
    .from(whatsappSessions)
    .where(ne(whatsappSessions.status, "disconnected"));

  return c.json({ data: rows });
});

/**
 * POST /internal/whatsapp/qr
 * Worker reports a new QR code for a user session.
 */
internal.post("/whatsapp/qr", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = qrSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const { userId, qrData } = parsed.data;

  const orgId = await resolveOrgIdFromUser(userId);
  if (!orgId) {
    return c.json({ error: "User not found" }, 404);
  }

  await db
    .insert(whatsappSessions)
    .values({ userId, orgId, status: "qr", qrData })
    .onConflictDoUpdate({
      target: whatsappSessions.userId,
      set: { status: "qr", qrData, phone: null, updatedAt: new Date() },
    });

  return c.json({ data: { status: "qr", userId, orgId } });
});

/**
 * POST /internal/whatsapp/status
 * Worker reports connection status change for a user session.
 */
internal.post("/whatsapp/status", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const { userId, status, phone } = parsed.data;

  const orgId = await resolveOrgIdFromUser(userId);
  if (!orgId) {
    return c.json({ error: "User not found" }, 404);
  }

  await db
    .insert(whatsappSessions)
    .values({ userId, orgId, status, phone: phone ?? null, qrData: null })
    .onConflictDoUpdate({
      target: whatsappSessions.userId,
      set: {
        status,
        phone: phone ?? null,
        qrData: null,
        updatedAt: new Date(),
      },
    });

  return c.json({ data: { status, userId, orgId, phone: phone ?? null } });
});

/**
 * POST /internal/whatsapp/message
 * Worker sends a user message to the RAG agent. Returns the agent's reply.
 */
internal.post("/whatsapp/message", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = messageSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const { userId, body: messageBody, chatId } = parsed.data;

  const orgId = await resolveOrgIdFromUser(userId);
  if (!orgId) {
    return c.json({ error: "User not found" }, 404);
  }

  try {
    const conversationId = await resolveConversationId(chatId, userId);

    const result = await ragAgent.generate(messageBody, {
      memory: { thread: conversationId, resource: orgId },
    });

    const sources = extractSources(result.steps ?? []);

    await persistMessages(conversationId, messageBody, result.text, {
      model: ragConfig.llmModel,
      retrievedChunks: sources.map((s) => s.id),
    });

    // Format for WhatsApp: strip markdown + append sources with URLs
    const waText = formatForWhatsApp(result.text) + buildSourcesFooter(sources);

    return c.json({ data: { reply: waText } });
  } catch (error) {
    console.error("[internal/message] RAG agent error:", error);
    return c.json({ error: "RAG agent unavailable" }, 503);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve or create a conversation for a WhatsApp chatId.
 * Uses a deterministic title so repeated calls from the same chat reuse the conversation.
 */
async function resolveConversationId(chatId: string, userId: string): Promise<string> {
  const existing = await db.query.conversations.findFirst({
    where: (conv, { eq }) => eq(conv.title, `whatsapp:${chatId}`),
    columns: { id: true },
  });

  if (existing) return existing.id;

  const [conv] = await db
    .insert(conversations)
    .values({ title: `whatsapp:${chatId}`, userId })
    .returning({ id: conversations.id });

  return conv!.id;
}

export default internal;
