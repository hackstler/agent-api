# vercel-sdk-migration

## Resumen ejecutivo

Migración completa del orquestador LLM de **Mastra.ai** (`@mastra/core`, `@mastra/memory`, `@mastra/pg`) a **Vercel AI SDK v6** (`ai` package). Se eliminó una capa intermedia innecesaria — Mastra internamente usaba Vercel AI SDK, así que estábamos pagando complejidad extra (schemas duplicados, `.payload` wrappers, memory automática que chocaba con nuestro modelo) sin beneficio real.

**54 archivos modificados**, **3 paquetes npm eliminados**, **3 archivos nuevos creados**, **1 archivo eliminado**.

---

## Motivación

### Problemas con Mastra

1. **Memory duplicada**: Mastra creaba su propio schema `mastra` en PostgreSQL con tablas de threads/messages que duplicaban nuestras tablas `conversations`/`messages`. Dos fuentes de verdad para lo mismo.

2. **`.payload` wrapper**: Mastra envolvía todos los resultados de tools en un objeto `.payload`, obligando a todo el código (controllers, helpers, streaming) a hacer unwrapping manual. Fuente constante de bugs sutiles.

3. **`RequestContext` opaco**: El sistema de contexto de Mastra usaba un `Map` interno difícil de tipar y debuggear. Pasábamos `userId`/`orgId` con un mecanismo que no daba type-safety.

4. **Delegación nativa rota**: El sistema de delegación entre agentes de Mastra (`agents` property) no funcionaba bien para nuestro patrón coordinator → sub-agents.

5. **Middleman innecesario**: Mastra internamente usa `generateText`/`streamText` de Vercel AI SDK. Estábamos añadiendo una capa de abstracción sobre otra abstracción.

### Objetivo a largo plazo

- **Control total sobre el pipeline LLM**: Sin capas intermedias que oculten el comportamiento real.
- **Reducir dependencias pesadas**: 3 paquetes npm menos = menos surface area de vulnerabilidades, builds más rápidos, menos riesgo de breaking changes upstream.
- **Memory propia**: Cargar historial de nuestra propia DB da control total sobre qué contexto ve el LLM, cuántos mensajes, filtros por tema, etc.
- **Preparar para multi-modelo**: Vercel AI SDK soporta cualquier provider (Gemini, OpenAI, Anthropic, etc.) con la misma API. Cambiar de modelo es cambiar una línea.

---

## Qué se hizo — paso a paso

### Fase 0: Infraestructura nueva

**Archivos creados:**

- **`src/agent/types.ts`** — Tipos core: `AgentContext` (userId, orgId, conversationId, pdfRequestId) y `AgentTools` (alias de `ToolSet` del AI SDK).

- **`src/agent/agent-runner.ts`** — Clase `AgentRunner`: wrapper mínimo sobre `generateText`/`streamText`. Reemplaza `Agent` de Mastra. Expone `.generate()` y `.stream()` con la misma interfaz.

- **`src/agent/load-history.ts`** — `loadConversationHistory()`: carga los últimos N mensajes de nuestra tabla `messages` como `ModelMessage[]`. Reemplaza `@mastra/memory`.

### Fase 1: Sistema de contexto

**`src/application/agent-context.ts`** — Reescrito:
- `createAgentContext()` devuelve un plain object `AgentContext` (no un `Map` de Mastra).
- `buildAgentOptions()` devuelve `{ experimental_context, maxSteps }` en vez de opciones Mastra.
- `getAgentContextValue()` extrae valores de `experimental_context` (Vercel AI SDK) — función centralizada usada por todas las tools.

### Fase 2: Migración de 21 tools

Transformación mecánica en todos los archivos de tools:

| Antes (Mastra) | Después (Vercel AI SDK) |
|---|---|
| `import { createTool } from "@mastra/core/tools"` | `import { tool } from "ai"` |
| `createTool({ id, description, inputSchema, outputSchema, execute })` | `tool({ description, inputSchema, execute })` |
| `execute: async (input, context)` | `execute: async (input, { experimental_context })` |
| `getAgentContextValue(context, "orgId")` | `getAgentContextValue({ experimental_context }, "orgId")` |

**Archivos afectados (21 tools):**
- RAG: `search-documents.ts`, `save-note.ts`, `search-web.ts`
- Gmail: `send-email.tool.ts`, `list-emails.tool.ts`, `read-email.tool.ts`, `search-emails.tool.ts`
- Calendar: `create-event.tool.ts`, `update-event.tool.ts`, `delete-event.tool.ts`, `list-events.tool.ts`
- Quote: `calculate-budget.tool.ts`, `list-catalog.tool.ts`
- Catalog Manager: `list-catalogs.tool.ts`, `list-catalog-items.tool.ts`, `create-catalog.tool.ts`, `add-item.tool.ts`, `update-item.tool.ts`, `delete-item.tool.ts`
- YouTube: `search-videos.tool.ts`, `get-video-details.tool.ts`

### Fase 3: Plugin interface y registry

- **`src/plugins/plugin.interface.ts`** — `agent: Agent` → `agent: AgentRunner`, `tools: ToolsInput` → `tools: AgentTools`
- **`src/plugins/plugin-registry.ts`** — Actualizado tipos `ToolsInput` → `AgentTools`

### Fase 4: 6 sub-agentes + 6 plugins

Cada agente: `new Agent({ id, name, instructions, model, tools })` → `new AgentRunner({ system, model, tools })`.

En `rag.agent.ts` además se eliminaron `Memory` y `PostgresStore` (ya no hay memory automática de Mastra).

**Archivos de agentes:** `rag.agent.ts`, `gmail.agent.ts`, `calendar.agent.ts`, `quote.agent.ts`, `catalog-manager.agent.ts`, `youtube.agent.ts`

**Archivos de plugins:** Los 6 `.plugin.ts` correspondientes (actualización de tipos).

### Fase 5: Coordinador y delegación

- **`src/agent/coordinator.ts`** — `new Agent()` → `new AgentRunner()`. Eliminados Memory/PostgresStore. System prompt mejorado (ver sección de conversacionalidad más abajo).

- **`src/agent/delegation.ts`** — `createTool()` → `tool()`. Los delegation tools ahora usan `experimental_context` para forwarding de contexto a sub-agentes.

### Fase 6: Streaming (SSE)

**`src/plugins/rag/routes/chat.routes.ts`** — Adaptado al formato de chunks de AI SDK v6:

| Mastra (antes) | AI SDK v6 (después) |
|---|---|
| `chunk.payload.text` | `chunk.text` (en `text-delta`) |
| `chunk.payload.toolName` | `chunk.toolName` |
| `chunk.payload.result` | `chunk.result` |
| `chunk.payload.finishReason` | `chunk.finishReason` |
| `step-start` / `step-finish` (chunk types) | `start-step` / `finish-step` (chunk types) |

**Importante:** Los eventos SSE emitidos al frontend **mantienen los mismos nombres** (`step-start`, `step-finish`, `text`, `sources`, `done`, etc.) — el mapeo se hace internamente.

Además se añadieron eventos `agent-start` / `agent-end` para delegation tools (ver sección de SSE más abajo).

### Fase 7: Non-streaming + helpers

- **`src/api/controllers/internal.controller.ts`** — Tipo `Agent` → `AgentRunner`, carga historial con `loadConversationHistory()`, elimina `.payload` unwrapping en `unwrapDelegationSteps()`.
- **`src/api/helpers/extract-sources.ts`** — Elimina `.payload` unwrapping.
- **`src/app.ts`** — Tipo `coordinatorAgent` actualizado.

### Fase 8: Tests

- **`src/__tests__/agent/helpers/test-app-e2e.ts`** — Reescrito para usar `AgentRunner`, `tool()`, `createDelegationTools()`.
- **`src/__tests__/helpers/test-app.ts`** — Añadido mock de `.stream()`.
- Tests E2E actualizados para esperar `agent-start` en vez de `tool-call` para delegaciones.

### Fase 9: Cleanup

- **`npm uninstall @mastra/core @mastra/memory @mastra/pg`** — 3 paquetes eliminados
- **`src/application/title-sync.ts`** — Eliminado (dependía de MastraMemory)
- **Documentación actualizada:** `CLAUDE.md`, `.claude/rules/rag-pipeline.md`, `.claude/rules/plugins.md`, `.claude/rules/hono-drizzle-mastra.md` → renombrado a `hono-drizzle-ai-sdk.md` y reescrita la sección de Mastra

---

## Fix adicional: Conversacionalidad + eventos SSE

Durante el testing post-migración se detectaron dos problemas graves:

### Problema 1: Agente robótico y repetitivo

**Síntoma:** El agente respondía siempre con "Soy Emilio, tu asistente personal. Estoy aquí para ayudarte con lo que necesites." a cualquier saludo o interacción casual.

**Causa:** El system prompt tenía una respuesta hardcodeada que el LLM usaba como template para TODO, no solo para la pregunta específica "¿qué eres?".

**Fix:** Se reescribió la sección de identidad del coordinador (`coordinator.ts`):
- Eliminada la respuesta template hardcodeada.
- Añadida sección `== CONVERSATIONAL STYLE ==` con instrucciones explícitas: ser natural, variar respuestas, nunca repetir el mismo saludo, leer el historial, adaptar tono al del usuario.

### Problema 2: Sin feedback visual en el frontend

**Síntoma:** El frontend no mostraba indicadores de actividad ("Buscando información...", "Preparando presupuesto...") durante las respuestas del agente.

**Causa:** El backend emitía `{ type: "tool-call", toolName: "delegateTo_rag" }` pero el frontend esperaba `{ type: "agent-start", agentId: "agent-rag" }`. Los nombres de las delegation tools (`delegateTo_*`) no coincidían con el mapping del frontend (`agent-*`).

**Fix** en `chat.routes.ts`:
- Cuando el coordinador llama a `delegateTo_X`, ahora se emite `{ type: "agent-start", agentId: "agent-X" }` en vez de un `tool-call` genérico.
- Cuando la delegación completa, se emite `{ type: "agent-end", agentId: "agent-X" }`.
- Se añadió extracción de sources anidadas dentro de resultados de delegación (antes, las sources de RAG se perdían porque solo se buscaban en tools directas, no dentro de delegation results).

---

## Bugs encontrados y corregidos durante la migración

### 1. Nombres de tipos en AI SDK v6

AI SDK v6 cambió nombres de tipos respecto a versiones anteriores:
- `LanguageModelV1` → `LanguageModel`
- `CoreMessage` → `ModelMessage`
- `CoreTool` → `ToolSet`

### 2. `maxSteps` no existe en AI SDK v6

Se reemplazó por `stopWhen: stepCountIs(n)`.

### 3. `parameters` vs `inputSchema` en `tool()`

La función `tool()` del AI SDK v6 usa `inputSchema` (no `parameters`) como key para el schema Zod. Afectaba a los 21 archivos de tools.

### 4. Formato de chunks del stream

En AI SDK v6:
- `text-delta` chunks tienen propiedad `text` (no `textDelta`)
- Step events son `start-step`/`finish-step` (no `step-start`/`step-finish`)

Esto causaba que los 3 E2E streaming tests fallaran — los chunks se procesaban pero `textDelta` era siempre `undefined`.

### 5. `exactOptionalPropertyTypes`

`onFinish: undefined` no era asignable. Se resolvió con spread condicional: `...(onFinish ? { onFinish } : {})`.

---

## Breaking changes

### Para el frontend: NINGUNO

Los eventos SSE emitidos mantienen exactamente el mismo formato:
- `text`, `sources`, `done`, `error`, `tool-call`, `tool-error`, `step-start`, `step-finish`, `attachment`

**Nuevos eventos añadidos** (no breaking — son aditivos):
- `agent-start` — cuando el coordinador delega a un sub-agente
- `agent-end` — cuando la delegación completa

El frontend ya tenía handlers para estos eventos, solo que antes nunca se emitían.

### Para el worker (WhatsApp): NINGUNO

El endpoint `/internal/whatsapp/message` mantiene el mismo contrato request/response.

### Para la base de datos

- Las tablas del schema `mastra` (creadas por `@mastra/memory`) quedan huérfanas. Se pueden eliminar manualmente cuando se confirme que todo funciona:
  ```sql
  DROP SCHEMA IF EXISTS mastra CASCADE;
  ```
- No se requiere ninguna migración nueva. Nuestras tablas (`conversations`, `messages`, etc.) no cambian.

### Para desarrollo

- `@mastra/core`, `@mastra/memory`, `@mastra/pg` ya no están disponibles como imports.
- Cualquier tool nueva debe usar `import { tool } from "ai"` con `inputSchema` (no `parameters`).
- Cualquier agente nuevo debe usar `new AgentRunner({ model, system, tools })`.
- El contexto se accede con `getAgentContextValue({ experimental_context }, "key")` dentro del execute de tools.

---

## Archivos nuevos

| Archivo | Propósito |
|---|---|
| `src/agent/types.ts` | `AgentContext`, `AgentTools` types |
| `src/agent/agent-runner.ts` | Wrapper sobre generateText/streamText |
| `src/agent/load-history.ts` | Carga historial de conversación de nuestra DB |
| `.claude/rules/hono-drizzle-ai-sdk.md` | Documentación de stack actualizada (renombrado de `hono-drizzle-mastra.md`) |

## Archivos eliminados

| Archivo | Razón |
|---|---|
| `src/application/title-sync.ts` | Dependía de MastraMemory para sincronizar títulos de threads |
| `.claude/rules/hono-drizzle-mastra.md` | Renombrado a `hono-drizzle-ai-sdk.md` |

## Paquetes npm

| Acción | Paquete | Versión |
|---|---|---|
| **Eliminado** | `@mastra/core` | ^1.13.2 |
| **Eliminado** | `@mastra/memory` | ^1.8.2 |
| **Eliminado** | `@mastra/pg` | ^1.8.0 |
| **Añadido** | `ai` | ^6.0.116 |

Nota: `@ai-sdk/google` ya estaba en el proyecto (Mastra lo usaba internamente).

---

## Verificación

- `npm run build` — pasa (tsc --noEmit + esbuild)
- `npm run test:unit` — 134 tests pasan
- `npm run test:integration` — 63 tests pasan
- E2E tests (requieren GOOGLE_API_KEY) — 4 suites pasan (1 test flaky por variabilidad de Gemini)
- `grep -r "@mastra" src/` — 0 resultados

---

## Puntos a tener en cuenta

1. **`experimental_context` de Vercel AI SDK**: Está marcado como experimental. Si cambia la API en futuras versiones, solo hay que tocar `getAgentContextValue()` y `AgentRunner` — el acceso está centralizado.

2. **Schema `mastra` huérfano**: Las tablas de memory de Mastra siguen en la DB. No molestan, pero ocupan espacio. Limpiar cuando se valide todo en producción.

3. **E2E tests con Gemini son flaky**: El test de WhatsApp RAG a veces falla porque la respuesta de Gemini no incluye las keywords esperadas. No es una regresión — ya era flaky antes.

4. **History window**: `loadConversationHistory()` carga los últimos 20 mensajes. Esto es configurable pero fijo por ahora. Si se necesita más contexto para conversaciones largas, ajustar el `windowSize`.

5. **`tool()` vs `inputSchema`**: AI SDK v6 usa `inputSchema` como key en la función `tool()`. Si alguna tool usa `parameters` por error, TypeScript lo catchea pero como `any` escape en algunos sitios, vale la pena verificar con grep.
