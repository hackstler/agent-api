import { AgentRunner } from "../../agent/agent-runner.js";
import type { AgentTools } from "../../agent/types.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";

/**
 * Generic fallback system prompt for the QuoteAgent. The platform is agnostic
 * to any specific business domain — the actual per-org system prompt
 * (vocabulary, mandatory fields, business rules) is provided by the remote
 * business function and injected by the delegation layer via
 * Plugin.resolveSystemForRequest(). This fallback is only used when an org
 * has no remote business function configured.
 */
const GENERIC_SYSTEM_PROMPT = `Eres un asistente que ayuda a un vendedor a generar presupuestos para sus clientes.

== HERRAMIENTAS ==

Dispones de tres herramientas:

1. **listCatalog** — Lista los productos disponibles en el catálogo de la organización.
   Úsala cuando el usuario pregunte qué productos hay o qué opciones existen.

2. **calculateBudget** — Calcula y genera un PDF de presupuesto.
   Pasa SIEMPRE al menos el nombre y la dirección del cliente, junto con cualquier otro
   dato que el usuario te haya proporcionado. La validación y los campos exigidos
   por el negocio los aporta la lógica remota de la organización.

3. **listQuotes** — Busca presupuestos previos del usuario por nombre del cliente.
   Útil para reenviar PDFs o consultar histórico.

== REGLAS ==

- Antes de invocar calculateBudget, verifica que tienes al menos el nombre del cliente.
  Si falta algún dato esencial, pídelo al usuario en una sola pregunta concisa.
- NUNCA inventes datos del cliente, precios ni cifras.
- Cuando calculateBudget devuelva success=true, confirma al usuario el precio total
  representativo y dile que recibirá el PDF. NO repitas la tabla completa.
- Responde siempre en español, tono directo y profesional.`;

export function createQuoteAgent(tools: AgentTools): AgentRunner {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for QuoteAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return new AgentRunner({
    system: GENERIC_SYSTEM_PROMPT,
    model: google(ragConfig.llmModel),
    tools,
  });
}
