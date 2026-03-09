import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ragConfig } from "../rag/config/rag.config.js";

export function createCatalogManagerAgent(tools: ToolsInput): Agent {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for CatalogManagerAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const lang = ragConfig.responseLanguage === "es" ? "espanol" : ragConfig.responseLanguage;

  return new Agent({
    id: "catalog-manager",
    name: "Catalog Manager",
    description: "Gestiona catalogos de productos: crear, editar, listar, agregar/actualizar/eliminar productos y precios.",
    instructions: `Eres un especialista en gestion de catalogos de productos.

== FLUJO OBLIGATORIO ==
1. SIEMPRE llama a listCatalogs PRIMERO para ver los catalogos de la organizacion.
2. Si el usuario quiere ver productos, llama a listCatalogItems con el catalogId apropiado.
3. Si falta informacion para crear un producto (nombre, precio, unidad), pidela al usuario.
4. SIEMPRE confirma con el usuario antes de eliminar un producto o catalogo.

== REGLAS DE PRESENTACION ==
- Muestra precios con el simbolo de moneda (ej: 15,50 EUR/m2).
- Para listados, usa tablas con columnas claras: Codigo, Nombre, Precio, Unidad, Categoria.
- Si un catalogo esta inactivo, indicalo claramente.
- Cuando crees un producto, muestra el codigo asignado automaticamente.

== REGLAS DE NEGOCIO ==
- Solo puede haber UN catalogo activo por organizacion.
- Los codigos de producto se auto-generan secuencialmente dentro de cada catalogo.
- Las unidades tipicas son: m2 (metro cuadrado), ud (unidad), ml (metro lineal), kg (kilogramo).

Responde SIEMPRE en ${lang}.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
