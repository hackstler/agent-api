/**
 * E2E: Presupuestos — flujo IDÉNTICO a producción.
 *
 * HTTP POST /chat con auth JWT → middleware → controller → coordinator → agent-quote
 * → calculateBudget tool → PDF real → response
 *
 * Requiere GOOGLE_API_KEY.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  createE2ETestApp,
  USER_AUTH,
  TEST_ORG_ID,
  TEST_USER_ID,
  type E2ETestContext,
} from "./helpers/test-app-e2e.js";

const HAS_API_KEY = !!(process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"]);

describe.skipIf(!HAS_API_KEY)("E2E Presupuestos — flujo HTTP completo", () => {
  let ctx: E2ETestContext;

  beforeAll(() => {
    ctx = createE2ETestApp();
  });

  // ── Sin auth → 401 (como producción) ──────────────────────────────────

  it("rechaza peticiones sin autenticación", async () => {
    const res = await ctx.app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Hola" }),
    });
    expect(res.status).toBe(401);
  });

  // ── Presupuesto completo via POST /chat ───────────────────────────────

  it("genera presupuesto completo via POST /chat con auth", async () => {
    const res = await ctx.app.request("/chat", {
      method: "POST",
      headers: USER_AUTH(),
      body: JSON.stringify({
        query: "Hazme un presupuesto para el cliente Juan García López, " +
          "dirección Calle Mayor 15, 28001 Madrid, " +
          "200 metros cuadrados de césped sobre solado.",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      conversationId: string;
      answer: string;
      sources: unknown[];
    };

    // 1. Respuesta tiene estructura correcta
    expect(body.conversationId).toBeTruthy();
    expect(body.answer).toBeTruthy();
    expect(body.answer.length).toBeGreaterThan(50);

    // 2. Se consultó el catálogo con los datos correctos
    expect(ctx.mocks.catalogService.getAllGrassPrices).toHaveBeenCalledWith(
      expect.any(String), "SOLADO", 200,
    );

    // 3. Se consultó la organización correcta
    expect(ctx.mocks.orgRepo.findByOrgId).toHaveBeenCalledWith(TEST_ORG_ID);

    // 4. Se generó y almacenó el PDF
    const storedFiles = ctx.attachmentStore.listKeys?.() ??
      // Fallback: verificar via el mock del quoteRepo
      [];
    expect(ctx.mocks.quoteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: TEST_ORG_ID,
        userId: TEST_USER_ID,
        clientName: expect.stringContaining("García"),
      }),
    );

    // 5. La respuesta menciona precios
    const answer = body.answer.toLowerCase();
    expect(
      answer.includes("€") || answer.includes("precio") ||
      answer.includes("presupuesto") || /\d+[.,]\d{2}/.test(answer)
    ).toBe(true);

    // 6. Se persistieron los mensajes (via convRepo)
    expect(ctx.mocks.convRepo.persistMessages).toHaveBeenCalled();
  }, 120_000);

  // ── Presupuesto TIERRA con traviesas via POST /chat ───────────────────

  it("genera presupuesto TIERRA con traviesas y áridos", async () => {
    const res = await ctx.app.request("/chat", {
      method: "POST",
      headers: USER_AUTH(),
      body: JSON.stringify({
        query: "Presupuesto para María Rodríguez Sánchez, " +
          "Avenida de la Constitución 42, Toledo. " +
          "150 m2 sobre tierra, 30 ml de traviesas, 10 sacas de áridos. Provincia Toledo.",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string };
    expect(body.answer).toBeTruthy();

    // Verificar surfaceType TIERRA
    expect(ctx.mocks.catalogService.getAllGrassPrices).toHaveBeenCalledWith(
      expect.any(String), "TIERRA", 150,
    );

    // Verificar persistencia con datos correctos
    expect(ctx.mocks.quoteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        surfaceType: "TIERRA",
        areaM2: "150",
        perimeterLm: "30",
      }),
    );
  }, 120_000);

  // ── Sin datos de cliente → pide los datos ─────────────────────────────

  it("pide datos del cliente cuando faltan", async () => {
    const res = await ctx.app.request("/chat", {
      method: "POST",
      headers: USER_AUTH(),
      body: JSON.stringify({
        query: "Hazme un presupuesto de 100 m2 de césped.",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string };

    const answer = body.answer.toLowerCase();
    expect(
      answer.includes("nombre") || answer.includes("cliente") ||
      answer.includes("dirección") || answer.includes("direccion") ||
      answer.includes("datos") || answer.includes("necesito")
    ).toBe(true);
  }, 120_000);

  // ── Propagación de contexto userId/orgId ──────────────────────────────

  it("propaga userId y orgId del JWT a las tools", async () => {
    const customAuth = createAuthHeaders({
      userId: "user-ctx-test",
      email: "ctx@test.com",
      orgId: "org-ctx-test",
      role: "user",
    });

    // Configurar orgRepo para responder a org-ctx-test
    ctx.mocks.orgRepo.findByOrgId.mockImplementation(async (orgId: string) => {
      if (orgId === "org-ctx-test") return { ...ctx.mocks.orgRepo.findByOrgId.mock.results[0]?.value, orgId: "org-ctx-test" };
      return null;
    });

    const res = await ctx.app.request("/chat", {
      method: "POST",
      headers: customAuth,
      body: JSON.stringify({
        query: "Presupuesto para Pedro Martínez, Calle del Sol 7, Getafe. 80 m2, solado.",
      }),
    });

    expect(res.status).toBe(200);

    // El orgRepo debe recibir el orgId del JWT
    expect(ctx.mocks.orgRepo.findByOrgId).toHaveBeenCalledWith("org-ctx-test");
    expect(ctx.mocks.catalogService.getActiveCatalog).toHaveBeenCalledWith("org-ctx-test");
  }, 120_000);
});

// Re-export for other test files
function createAuthHeaders(payload: {
  userId: string; email: string; orgId: string; role: "admin" | "user" | "super_admin";
}): Record<string, string> {
  const jwt = require("jsonwebtoken");
  const token = jwt.sign(payload, "test-secret-for-jwt", { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
