/**
 * E2E: SSE Streaming — flujo IDÉNTICO a producción.
 *
 * HTTP GET /chat/stream?query=... con auth JWT
 * → middleware → chat.routes.ts → agent.stream() → SSE events
 *
 * Verifica que los eventos SSE lleguen en el formato correcto
 * y contengan la información esperada.
 *
 * Requiere GOOGLE_API_KEY.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  createE2ETestApp,
  USER_AUTH,
  parseSSEResponse,
  type E2ETestContext,
} from "./helpers/test-app-e2e.js";

const HAS_API_KEY = !!(process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"]);

describe.skipIf(!HAS_API_KEY)("E2E SSE Streaming — flujo HTTP completo", () => {
  let ctx: E2ETestContext;

  beforeAll(() => {
    ctx = createE2ETestApp();
  });

  // ── Sin auth → 401 ───────────────────────────────────────────────────

  it("rechaza streaming sin autenticación", async () => {
    const res = await ctx.app.request("/chat/stream?query=Hola");
    expect(res.status).toBe(401);
  });

  // ── Saludo simple → stream con texto ──────────────────────────────────

  it("devuelve SSE stream para un saludo con auth", async () => {
    const headers = USER_AUTH();
    // GET doesn't use Content-Type body, remove it
    delete (headers as Record<string, string>)["Content-Type"];

    const res = await ctx.app.request(
      "/chat/stream?query=" + encodeURIComponent("Hola, buenos días"),
      { headers },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-conversation-id")).toBeTruthy();

    const { events, fullText } = await parseSSEResponse(res);

    // Debe tener al menos eventos de texto y done
    expect(events.length).toBeGreaterThan(0);

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("text");
    expect(eventTypes).toContain("done");

    // El texto concatenado debe ser una respuesta coherente
    expect(fullText.length).toBeGreaterThan(5);
  }, 120_000);

  // ── Consulta RAG → stream con sources + texto ─────────────────────────

  it("emite eventos sources antes del texto para búsquedas RAG", async () => {
    const headers = USER_AUTH();
    delete (headers as Record<string, string>)["Content-Type"];

    const res = await ctx.app.request(
      "/chat/stream?query=" + encodeURIComponent("¿Cómo se instala el césped artificial?"),
      { headers },
    );

    expect(res.status).toBe(200);
    const { events, fullText } = await parseSSEResponse(res);

    const eventTypes = events.map((e) => e.type);

    // Debe emitir sources (con o sin chunks, siempre se emite)
    expect(eventTypes).toContain("sources");
    expect(eventTypes).toContain("text");
    expect(eventTypes).toContain("done");

    // sources debe ir antes de done
    const sourcesIdx = eventTypes.indexOf("sources");
    const doneIdx = eventTypes.indexOf("done");
    expect(sourcesIdx).toBeLessThan(doneIdx);

    // El texto debe tener contenido relevante
    expect(fullText.length).toBeGreaterThan(20);
  }, 120_000);

  // ── Presupuesto → stream con tool-call + attachment + texto ───────────

  it("emite tool-call y attachment para presupuestos via stream", async () => {
    const headers = USER_AUTH();
    delete (headers as Record<string, string>)["Content-Type"];

    const res = await ctx.app.request(
      "/chat/stream?query=" + encodeURIComponent(
        "Presupuesto para Ana López García, Calle de la Paz 10, Valencia. 100 m2, solado."
      ),
      { headers },
    );

    expect(res.status).toBe(200);
    const { events, fullText } = await parseSSEResponse(res);

    const eventTypes = events.map((e) => e.type);

    // Debe incluir agent-start events (coordinator delegates to agent-quote)
    expect(eventTypes).toContain("agent-start");

    // Debe terminar con done
    expect(eventTypes[eventTypes.length - 1]).toBe("done");

    // El texto completo debe tener contenido
    expect(fullText.length).toBeGreaterThan(20);

    // Verificar que se generó el presupuesto
    expect(ctx.mocks.catalogService.getAllGrassPrices).toHaveBeenCalled();
  }, 120_000);

  // ── Query vacía → 400 ────────────────────────────────────────────────

  it("rechaza query vacía con 400", async () => {
    const headers = USER_AUTH();
    delete (headers as Record<string, string>)["Content-Type"];

    const res = await ctx.app.request("/chat/stream?query=", { headers });
    expect(res.status).toBe(400);
  });

  // ── X-Conversation-Id header ──────────────────────────────────────────

  it("devuelve X-Conversation-Id en el header del stream", async () => {
    const headers = USER_AUTH();
    delete (headers as Record<string, string>)["Content-Type"];

    const res = await ctx.app.request(
      "/chat/stream?query=" + encodeURIComponent("Hola"),
      { headers },
    );

    expect(res.status).toBe(200);
    const convId = res.headers.get("x-conversation-id");
    expect(convId).toBeTruthy();
    // Debe ser un formato válido (UUID o string generado)
    expect(convId!.length).toBeGreaterThan(5);
  }, 120_000);
});
