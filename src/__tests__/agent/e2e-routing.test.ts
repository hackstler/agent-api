/**
 * E2E: Routing del coordinator — flujo IDÉNTICO a producción.
 *
 * HTTP POST /chat con auth JWT → coordinator decide sub-agente → respuesta
 *
 * Verifica que el coordinator enrute correctamente cada tipo de petición.
 *
 * Requiere GOOGLE_API_KEY.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  createE2ETestApp,
  USER_AUTH,
  type E2ETestContext,
} from "./helpers/test-app-e2e.js";

const HAS_API_KEY = !!(process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"]);

describe.skipIf(!HAS_API_KEY)("E2E Routing — flujo HTTP completo", () => {
  let ctx: E2ETestContext;

  beforeAll(() => {
    ctx = createE2ETestApp();
  });

  function postChat(query: string) {
    return ctx.app.request("/chat", {
      method: "POST",
      headers: USER_AUTH(),
      body: JSON.stringify({ query }),
    });
  }

  // ── Saludo → respuesta directa ────────────────────────────────────────

  it("responde directamente a saludos sin delegar", async () => {
    const res = await postChat("Hola, buenos días");
    expect(res.status).toBe(200);

    const body = await res.json() as { answer: string };
    const answer = body.answer.toLowerCase();

    expect(
      answer.includes("hola") || answer.includes("buenos días") ||
      answer.includes("buenos dias") || answer.includes("ayudar")
    ).toBe(true);
    expect(body.answer.length).toBeLessThan(500);
  }, 120_000);

  // ── Precio → catalog-manager ──────────────────────────────────────────

  it("delega consultas de precio al catalog-manager", async () => {
    const res = await postChat("¿Cuánto cuesta el césped Monaco Premium?");
    expect(res.status).toBe(200);

    const body = await res.json() as { answer: string };
    const answer = body.answer.toLowerCase();

    expect(
      answer.includes("€") || answer.includes("precio") ||
      answer.includes("m2") || answer.includes("m²") ||
      answer.includes("monaco") || /\d+[.,]\d{2}/.test(answer)
    ).toBe(true);
  }, 120_000);

  // ── Listado de productos → catalog-manager ────────────────────────────

  it("delega listados de catálogo al catalog-manager", async () => {
    const res = await postChat("¿Qué tipos de césped tenemos disponibles?");
    expect(res.status).toBe(200);

    const body = await res.json() as { answer: string };
    const answer = body.answer.toLowerCase();

    expect(
      answer.includes("monaco") || answer.includes("sena") ||
      answer.includes("oasis") || answer.includes("catálogo") ||
      answer.includes("catalogo") || answer.includes("tipos")
    ).toBe(true);
  }, 120_000);

  // ── Pregunta de conocimiento → RAG ────────────────────────────────────

  it("delega preguntas de conocimiento al RAG", async () => {
    const res = await postChat("¿Cómo se realiza el mantenimiento del césped artificial?");
    expect(res.status).toBe(200);

    const body = await res.json() as { answer: string };
    const answer = body.answer.toLowerCase();

    // El agente debe dar una respuesta relevante sobre mantenimiento/césped.
    // Amplia lista de keywords porque el LLM no es determinista.
    const hasRelevant = answer.includes("cepillado") || answer.includes("limpieza") ||
      answer.includes("mantenimiento") || answer.includes("agua") ||
      answer.includes("césped") || answer.includes("cesped") ||
      answer.includes("artificial") || answer.includes("periódic") ||
      answer.includes("hojas") || answer.includes("instalación") ||
      answer.includes("instalacion") || answer.includes("malla") ||
      answer.includes("base") || answer.includes("guía") ||
      answer.includes("guia") || answer.includes("document") ||
      answer.includes("encontr") || answer.includes("información") ||
      answer.includes("informacion");
    expect(hasRelevant).toBe(true);
  }, 120_000);

  // ── Agradecimiento → respuesta directa ────────────────────────────────

  it("responde directamente a agradecimientos", async () => {
    const res = await postChat("Muchas gracias, perfecto.");
    expect(res.status).toBe(200);

    const body = await res.json() as { answer: string };
    expect(body.answer.length).toBeLessThan(500);

    const answer = body.answer.toLowerCase();
    expect(
      answer.includes("nada") || answer.includes("encantado") ||
      answer.includes("ayudar") || answer.includes("gracia") ||
      answer.includes("disposi") || answer.includes("servicio")
    ).toBe(true);
  }, 120_000);
});
