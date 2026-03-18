# Plugin Architecture Rules

## Concepto
Los plugins encapsulan funcionalidad extendida: agent, tools, routes, config.
El coordinator agent orquesta todos los plugins registrados.

## Contrato Plugin

Interface en `src/plugins/plugin.interface.ts`:
```typescript
import type { AgentRunner } from "../agent/agent-runner.js";
import type { AgentTools } from "../agent/types.js";

interface Plugin {
  id: string              // identificador único (ej: "rag", "quote")
  name: string            // nombre descriptivo
  description: string     // para el system prompt del coordinator
  agent: AgentRunner      // Vercel AI SDK agent del plugin
  tools: AgentTools       // tools que expone al coordinator (ToolSet)
  routes?(): Hono         // rutas HTTP propias (ej: /chat, /ingest)
  ensureTables?(): Promise<void>   // crear tablas propias si no existen
  initialize?(): Promise<void>     // setup al arrancar
  shutdown?(): Promise<void>       // cleanup al parar
}
```

## Plugin Registry

Archivo: `src/plugins/plugin-registry.ts`

- `register(plugin)` — registrar un plugin
- `getAllTools()` — agregar tools de todos los plugins para el coordinator
- `getRoutes()` — montar rutas de todos los plugins
- `initializeAll()` / `shutdownAll()` — lifecycle

## Plugins actuales

### RAG Plugin (`src/plugins/rag/`)
- **Agent**: RAG agent con Gemini 2.5-flash
- **Tools**: searchDocuments, saveNote, searchWeb
- **Routes**: POST /chat (SSE streaming), POST /ingest
- **Config**: `rag.config.ts`, `tools.config.ts`
- **Pipeline**: embeddings → retriever → reranker → context builder
- **Ingestion**: loader → processor → enricher → contextualizer

### Quote Plugin (`src/plugins/quote/`)
- **Agent**: Quote agent para presupuestos
- **Tools**: calculateBudget (cálculo + PDF)
- **Services**: catalog.service.ts (lookup), pdf.service.ts (generación)
- **Config**: quote.config.ts
- **DB**: catalogs + catalog_items (seeded en startup)

## Coordinator Agent

Archivo: `src/agent/coordinator.ts`

- Agente principal (Emilio) que orquesta todos los plugins
- Recibe todas las tools de todos los plugins via `pluginRegistry.getAllTools()`
- Decide qué tool usar según la query del usuario
- Es el punto de entrada para `/chat` y `/internal/whatsapp/message`

## Cómo añadir un plugin nuevo

1. Crear carpeta `src/plugins/<nombre>/`
2. Implementar `Plugin` interface en `<nombre>.plugin.ts`
3. Definir agent, tools, routes, config dentro del plugin
4. Registrar en `src/index.ts`: `pluginRegistry.register(new MiPlugin(deps))`
5. El coordinator automáticamente tendrá acceso a las tools del plugin

## Reglas
- Cada plugin es **autocontenido**: agent + tools + routes + config + services
- Plugins **NO** importan de otros plugins directamente
- La comunicación entre plugins es via el coordinator (que tiene todas las tools)
- Si un plugin necesita tablas propias, usa `ensureTables()` o migraciones
- Plugin config vive dentro del plugin (`src/plugins/<nombre>/config/`)
