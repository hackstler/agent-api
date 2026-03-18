# Hono + Drizzle + Vercel AI SDK — Deep Stack Rules

Complementa las reglas en `api-design.md`, `data-model.md`, `rag-pipeline.md` y `plugins.md`.

---

## Hono

### Middleware chain (orden estricto)
```
logger → secureHeaders → cors → auth → route handler
```
No alterar el orden. Auth siempre después de CORS.

### Context variables
```typescript
declare module 'hono' {
  interface ContextVariableMap {
    user: { userId: string; orgId: string; role: "user" | "admin" }
    workerOrgId: string  // set by requireWorker (optional)
  }
}

// En handlers
const user = c.get("user")       // authMiddleware
const orgId = c.get("workerOrgId") // requireWorker
```

### App factory
```typescript
// src/app.ts — crea la app Hono con todas las rutas
export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  // middleware global
  // rutas de controllers
  // rutas de plugins (via pluginRegistry.getRoutes())
  // error handler
  return app
}
```

### Validación
- Validar con Zod **antes** de procesar cualquier input
- `const body = schema.parse(await c.req.json())`
- `const query = schema.parse(c.req.query())`

### Response format
```typescript
return c.json({ data: result })
return c.json({ error: "Validation", message: "Invalid input" }, 400)
```

---

## Drizzle

### UUIDs
```typescript
id: uuid('id').defaultRandom().primaryKey()
```

### Timestamps
```typescript
createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
```

### Upserts atómicos
```typescript
await db.insert(table)
  .values(data)
  .onConflictDoUpdate({
    target: table.uniqueColumn,
    set: { ...updates, updatedAt: new Date() }
  })
```

### Relations
```typescript
export const tableRelations = relations(table, ({ one, many }) => ({
  parent: one(parentTable, { fields: [table.parentId], references: [parentTable.id] }),
  children: many(childTable),
}))
```

### Type inference
```typescript
// Infrastructure types (src/infrastructure/db/schema.ts)
export type Session = typeof whatsappSessions.$inferSelect
export type NewSession = typeof whatsappSessions.$inferInsert

// Domain entities (src/domain/entities/index.ts) — pure interfaces
// Domain/Application importan de domain, NO de schema
```

### Pool singleton
```typescript
const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  max: 10,
  idleTimeoutMillis: 30_000,
})
```
Un solo pool por proceso. No crear pools por request.

---

## Vercel AI SDK

### AgentRunner (wrapper sobre generateText/streamText)
```typescript
import { AgentRunner } from "../agent/agent-runner.js";
import type { AgentGenerateResult, AgentStreamResult } from "../agent/types.js";

const agent = new AgentRunner({
  model: geminiModel,
  system: systemPrompt,
  tools: pluginRegistry.getAllTools(),
  maxSteps: 10,
});

// Non-streaming — returns AgentGenerateResult (typed: .text, .steps[].toolResults[])
const result: AgentGenerateResult = await agent.generate({
  prompt: query,
  messages: history,
  experimental_context: { userId, orgId, conversationId },
});

// Streaming — returns AgentStreamResult (typed: .fullStream async iterable)
const stream: AgentStreamResult = await agent.stream({
  prompt: query,
  messages: history,
  experimental_context: { userId, orgId, conversationId },
});
```

### Typed results — domain types
```typescript
// AgentGenerateResult: { text: string; steps: AgentStep[] }
// AgentStep: { toolResults: AgentToolResult[] }
// AgentToolResult: { toolName: string; result: unknown }
// DelegationResult: { text: string; toolResults: AgentToolResult[] }
// AgentStreamResult: { fullStream: AsyncIterable<AgentStreamChunk> }
```
Los tipos están en `src/agent/types.ts`. Usar siempre estos tipos de dominio, NO los internos del AI SDK.

### Memory (DIY — sin dependencias externas)
```typescript
import { loadConversationHistory } from "../agent/load-history.js";

// Carga últimos N mensajes de nuestra tabla `messages`
// Incluye contexto de tools usadas en turnos anteriores (metadata.toolCalls)
const history = await loadConversationHistory(convManager, conversationId, 20);
```
No usamos memory de terceros. El historial se carga de nuestras propias tablas.
Los mensajes del asistente incluyen `[Herramientas: ...]` si hubo tool calls en ese turno.

### Tools — Plugin Pattern
```typescript
import { tool } from "ai";

// Cada plugin expone tools via su propiedad `tools`
// El coordinator las recibe agregadas por pluginRegistry.getAllTools()

// Factory pattern con inyección de dependencias:
export function createSearchDocumentsTool(deps: ToolDeps) {
  return tool({
    description: "...",
    inputSchema: z.object({ ... }),
    execute: async (input, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      // ...
    }
  });
}
```

### experimental_context (paso de contexto a tools)
```typescript
import { getAgentContextValue } from "../application/agent-context.js";

// Dentro de execute de cualquier tool:
execute: async (input, { experimental_context }) => {
  const orgId = getAgentContextValue({ experimental_context }, "orgId");
  const userId = getAgentContextValue({ experimental_context }, "userId");
}
```
Centralizado en `agent-context.ts`. No acceder directamente a `experimental_context`.

### Delegation (coordinator → sub-agentes)
```typescript
import { createDelegationTools } from "../agent/delegation.js";
import type { DelegationResult } from "../agent/types.js";

// Crea un tool() por cada plugin registrado
const delegationTools = createDelegationTools(plugins);
// Nombres: delegateTo_rag, delegateTo_quote, etc.

// Cada delegation tool devuelve DelegationResult { text, toolResults }
// toolResults contiene los resultados de los tools del sub-agente (no del coordinator)
```

### Tool results y persistencia
```typescript
import { extractToolSummaries, summarizeToolCall } from "../agent/tool-summaries.js";

// En generate(): extraer summaries de los steps
const summaries = extractToolSummaries(result.steps);

// En streaming: construir summaries chunk a chunk
collectedToolSummaries.push({
  toolName,
  summary: summarizeToolCall({ toolName, result }),
});

// Persistir con metadata de tools para memoria cross-turn
await convManager.persistMessages(conversationId, query, text, {
  model: ragConfig.llmModel,
  retrievedChunks: sources.map(s => s.id),
  toolCalls: summaries,  // ← se guardan en metadata.toolCalls
});
```

### Persistencia en streaming (split)
```typescript
// 1. Persistir mensaje del usuario ANTES del stream (sobrevive a fallos)
await convManager.persistUserMessage(conversationId, query);

// 2. Stream completo...

// 3. Persistir respuesta del asistente DESPUÉS del stream
await convManager.persistAssistantMessage(conversationId, fullAnswer, {
  model: ragConfig.llmModel,
  retrievedChunks: [...],
  toolCalls: collectedToolSummaries,
});
```

### System prompt
Secciones con `== TÍTULO ==` y template literals:
```typescript
const systemPrompt = `
== ROL ==
Eres Emilio, asistente especializado...

== HERRAMIENTAS ==
${pluginDescriptions}

== REGLAS ==
...
`
```
