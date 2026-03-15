/**
 * E2E: WhatsApp — flujo IDÉNTICO a producción.
 *
 * HTTP POST /internal/whatsapp/message con worker JWT
 * → requireWorker middleware → internal controller → coordinator → agent → tools → response
 *
 * Este es el flujo que sigue un mensaje real de WhatsApp:
 * Worker → POST /internal/whatsapp/message → agent.generate() → reply JSON
 *
 * Requiere GOOGLE_API_KEY.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  createE2ETestApp,
  WORKER_AUTH,
  TEST_ORG_ID,
  TEST_USER_ID,
  type E2ETestContext,
} from "./helpers/test-app-e2e.js";
import { fakeUser, fakeConversation } from "../helpers/mock-repos.js";

const HAS_API_KEY = !!(process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"]);

describe.skipIf(!HAS_API_KEY)("E2E WhatsApp — flujo HTTP completo", () => {
  let ctx: E2ETestContext;

  beforeAll(() => {
    ctx = createE2ETestApp();

    // Configurar mocks para el flujo WhatsApp
    // El worker envía userId → waManager.resolveOrgId(userId) busca el user en DB
    ctx.mocks.userRepo.findById.mockImplementation(async (id: string) =>
      fakeUser({ id, orgId: TEST_ORG_ID, email: "vendedor@test.com" }),
    );

    // resolveOrCreateForChannel: busca conv por channelRef, si no existe la crea
    ctx.mocks.convRepo.findByChannelRef.mockResolvedValue(null);
    ctx.mocks.convRepo.create.mockImplementation(async (data: Record<string, unknown>) =>
      fakeConversation({ id: `wa-conv-${Date.now()}`, ...data } as any),
    );
  });

  // ── Sin auth worker → 401 ────────────────────────────────────────────

  it("rechaza mensajes sin JWT de worker", async () => {
    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TEST_USER_ID,
        messageId: "msg-001",
        body: "Hola",
        chatId: "34612345678@c.us",
      }),
    });
    expect(res.status).toBe(401);
  });

  // ── Auth de usuario normal → 403 (no es worker) ──────────────────────

  it("rechaza mensajes con JWT de usuario normal (no worker)", async () => {
    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
      { userId: TEST_USER_ID, email: "user@test.com", orgId: TEST_ORG_ID, role: "user" },
      "test-secret-for-jwt",
      { expiresIn: "1h" },
    );

    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: TEST_USER_ID,
        messageId: "msg-002",
        body: "Hola",
        chatId: "34612345678@c.us",
      }),
    });
    expect(res.status).toBe(403);
  });

  // ── Saludo simple via WhatsApp ────────────────────────────────────────

  it("procesa un saludo via WhatsApp con auth worker", async () => {
    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: WORKER_AUTH(),
      body: JSON.stringify({
        userId: TEST_USER_ID,
        messageId: "msg-003",
        body: "Hola buenos días",
        chatId: "34612345678@c.us",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reply: string; document?: unknown } };

    expect(body.data).toBeDefined();
    expect(body.data.reply).toBeTruthy();
    expect(body.data.reply.length).toBeGreaterThan(5);

    // Un saludo no genera PDF
    expect(body.data.document).toBeUndefined();
  }, 120_000);

  // ── Presupuesto completo via WhatsApp ─────────────────────────────────

  it("genera presupuesto completo via WhatsApp", async () => {
    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: WORKER_AUTH(),
      body: JSON.stringify({
        userId: TEST_USER_ID,
        messageId: "msg-004",
        body: "Presupuesto para Carlos Ruiz Fernández, Calle Gran Vía 22, Madrid. 120 m2, solado.",
        chatId: "34612345678@c.us",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reply: string; document?: { base64: string; mimetype: string; filename: string } } };

    expect(body.data.reply).toBeTruthy();

    // Verificar que se llamó al catálogo
    expect(ctx.mocks.catalogService.getAllGrassPrices).toHaveBeenCalled();

    // Verificar que se persistió el presupuesto
    expect(ctx.mocks.quoteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: TEST_ORG_ID,
        clientName: expect.stringContaining("Ruiz"),
      }),
    );

    // Verificar que se persistieron los mensajes
    expect(ctx.mocks.convRepo.persistMessages).toHaveBeenCalled();
  }, 120_000);

  // ── Consulta RAG via WhatsApp ─────────────────────────────────────────

  it("busca en la base de conocimiento via WhatsApp", async () => {
    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: WORKER_AUTH(),
      body: JSON.stringify({
        userId: TEST_USER_ID,
        messageId: "msg-005",
        body: "¿Cómo se instala el césped artificial sobre tierra?",
        chatId: "34612345678@c.us",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reply: string } };

    expect(body.data.reply).toBeTruthy();

    // La respuesta debe incluir contenido relevante
    const reply = body.data.reply.toLowerCase();
    expect(
      reply.includes("tierra") || reply.includes("nivelar") ||
      reply.includes("base") || reply.includes("malla") ||
      reply.includes("zahorra") || reply.includes("instala")
    ).toBe(true);
  }, 120_000);

  // ── Validación del body ───────────────────────────────────────────────

  it("rechaza body inválido con 400", async () => {
    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: WORKER_AUTH(),
      body: JSON.stringify({
        // Falta userId, messageId, chatId
        body: "Hola",
      }),
    });
    expect(res.status).toBe(400);
  });
});
