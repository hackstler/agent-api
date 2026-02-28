import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { whatsappSessions, conversations, users } from "../db/schema.js";
import { ragAgent } from "../agent/index.js";
import { ragConfig } from "../config/rag.config.js";
import { extractSources } from "./helpers/extract-sources.js";
import { persistMessages } from "./helpers/persist-messages.js";

const internal = new Hono();

// ── Schemas ────────────────────────────────────────────────────────────────────

const qrSchema = z.object({
  qrData: z.string().min(1),
  orgId: z.string().min(1).optional(),
});

const statusSchema = z.object({
  status: z.enum(["connected", "disconnected"]),
  phone: z.string().optional(),
  orgId: z.string().min(1).optional(),
});

const messageSchema = z.object({
  messageId: z.string().min(1),
  body: z.string().min(1).max(10_000),
  chatId: z.string().min(1),
  orgId: z.string().min(1).optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve orgId: JWT first (legacy single-org workers), body as fallback (multi-org workers).
 */
function resolveOrgId(c: Context, bodyOrgId?: string): string | null {
  return c.get("workerOrgId") ?? bodyOrgId ?? null;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * GET /internal/whatsapp/orgs
 * Returns all distinct org IDs that have at least one user.
 */
internal.get("/whatsapp/orgs", async (c) => {
  const rows = await db
    .selectDistinct({ orgId: users.orgId })
    .from(users)
    .where(sql`${users.orgId} IS NOT NULL`);

  const orgIds = rows.map((r) => r.orgId).filter((id): id is string => id !== null);
  return c.json({ data: orgIds });
});

/**
 * POST /internal/whatsapp/qr
 * Worker reports a new QR code for its org.
 */
internal.post("/whatsapp/qr", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = qrSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const orgId = resolveOrgId(c, parsed.data.orgId);
  if (!orgId) {
    return c.json({ error: "orgId required (JWT or body)" }, 400);
  }

  await db
    .insert(whatsappSessions)
    .values({ orgId, status: "qr", qrData: parsed.data.qrData })
    .onConflictDoUpdate({
      target: whatsappSessions.orgId,
      set: { status: "qr", qrData: parsed.data.qrData, phone: null, updatedAt: new Date() },
    });

  return c.json({ data: { status: "qr", orgId } });
});

/**
 * POST /internal/whatsapp/status
 * Worker reports connection status change.
 */
internal.post("/whatsapp/status", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const orgId = resolveOrgId(c, parsed.data.orgId);
  if (!orgId) {
    return c.json({ error: "orgId required (JWT or body)" }, 400);
  }

  const { status, phone } = parsed.data;

  await db
    .insert(whatsappSessions)
    .values({ orgId, status, phone: phone ?? null, qrData: null })
    .onConflictDoUpdate({
      target: whatsappSessions.orgId,
      set: {
        status,
        phone: phone ?? null,
        qrData: null, // clear QR on status change
        updatedAt: new Date(),
      },
    });

  return c.json({ data: { status, orgId, phone: phone ?? null } });
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

  const orgId = resolveOrgId(c, parsed.data.orgId);
  if (!orgId) {
    return c.json({ error: "orgId required (JWT or body)" }, 400);
  }

  const { body: messageBody, chatId } = parsed.data;

  try {
    // Use chatId as conversation thread, orgId as resource for multi-tenancy
    const conversationId = await resolveConversationId(chatId, orgId);

    const result = await ragAgent.generate(messageBody, {
      memory: { thread: conversationId, resource: orgId },
    });

    const sources = extractSources(result.steps ?? []);

    await persistMessages(conversationId, messageBody, result.text, {
      model: ragConfig.llmModel,
      retrievedChunks: sources.map((s) => s.id),
    });

    return c.json({ data: { reply: result.text } });
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
async function resolveConversationId(chatId: string, orgId: string): Promise<string> {
  // Look for an existing conversation for this WhatsApp chat
  const existing = await db.query.conversations.findFirst({
    where: (conv, { and, eq }) =>
      and(eq(conv.title, `whatsapp:${chatId}`)),
    columns: { id: true },
  });

  if (existing) return existing.id;

  const [conv] = await db
    .insert(conversations)
    .values({ title: `whatsapp:${chatId}` })
    .returning({ id: conversations.id });

  return conv!.id;
}

export default internal;
