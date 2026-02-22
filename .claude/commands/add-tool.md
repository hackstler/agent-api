# /add-tool

Add a new Mastra tool to the agent's tool registry.

## Usage
/add-tool <tool-name> "<description>"

Examples:
- /add-tool summarize-document "Summarizes a document by ID"
- /add-tool list-documents "Lists all indexed documents with metadata"

## What this skill does

1. Reads `src/agent/tools/search-documents.ts` as the reference pattern
2. Reads `src/agent/tools/base.ts` for `ToolEntry` and `ToolRegistryDeps`
3. Reads `src/agent/tools/index.ts` to ver `ALL_TOOLS`
4. Reads `src/config/tools.config.ts` para ver las tools activas
5. Genera `src/agent/tools/<tool-name>.ts` con:
   - `create<PascalCase>Tool(deps)` — factory function
   - `<camelCase>Entry: ToolEntry` — self-registering entry
   - `inputSchema` con Zod + `.describe()` en cada campo
   - `outputSchema`
   - `execute` con la lógica
   - `deps: ToolRegistryDeps` solo si la tool necesita embedder/retriever/reranker
6. Añade la entrada en `ALL_TOOLS` en `tools/index.ts` (un import + una línea)
7. Añade la key en `src/config/tools.config.ts` (una línea)
8. Ejecuta `npx tsc --noEmit` para verificar tipos
9. Muestra el diff al usuario

## Instructions for Claude

When this skill is invoked:

### Step 1 — Parse arguments
- Tool name: kebab-case → filename `<tool-name>.ts`
- Factory function: `create<PascalCase>Tool`
- Entry export: `<camelCase>Entry`
- Registry key: `<camelCase>`

### Step 2 — Read these files first
- `src/agent/tools/search-documents.ts` — reference pattern
- `src/agent/tools/base.ts` — ToolEntry + ToolRegistryDeps
- `src/agent/tools/index.ts` — ALL_TOOLS array
- `src/config/tools.config.ts` — active tools config

### Step 3 — Decide deps
- Needs `ToolRegistryDeps` if the tool searches documents (embedder/retriever/reranker)
- Does NOT need deps if it's an external API, utility, or doesn't touch pgvector

### Step 4 — Generate `src/agent/tools/<tool-name>.ts`

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolEntry, ToolRegistryDeps } from "./base.js";
// import { ragConfig } from "../../config/rag.config.js"; // if needed

/**
 * <Description: what it does and when the agent should call it>
 */
export const <camelCase>Entry: ToolEntry = {
  key: "<camelCase>",
  create: (deps) => create<PascalCase>Tool(deps), // or (_deps) if no RAG deps
};

export function create<PascalCase>Tool(deps: ToolRegistryDeps) {
  return createTool({
    id: "<tool-name>",
    description: `<Clear description.
WHEN to call it. WHAT it returns.>`,
    inputSchema: z.object({
      // every field must have .describe()
    }),
    outputSchema: z.object({
      // typed return shape
    }),
    execute: async ({ /* input fields */ }) => {
      // implementation using deps.embedder / deps.retriever / deps.reranker if needed
    },
  });
}
```

### Step 5 — Update `src/agent/tools/index.ts`

Add import and entry to `ALL_TOOLS`:

```typescript
import { <camelCase>Entry } from "./<tool-name>.js"; // ← add import

const ALL_TOOLS: ToolEntry[] = [
  searchDocumentsEntry,
  searchWebEntry,
  <camelCase>Entry,  // ← add here
];
```

### Step 6 — Update `src/config/tools.config.ts`

```typescript
export const toolsConfig = {
  searchDocuments: { enabled: true, description: "..." },
  searchWeb:       { enabled: ...,  description: "..." },
  <camelCase>:     { enabled: true, description: "<one-line description>" }, // ← add
} satisfies Record<string, { enabled: boolean; description: string }>;
```

### Step 7 — Validate
```bash
npx tsc --noEmit
```

### Step 8 — Show diff
Show the user the new file + changes to `index.ts` and `tools.config.ts`.

## Rules
- Never modify existing tool files (Open/Closed principle)
- Use `z.string().describe("...")` on every input field
- Always export both the `Entry` (for registry) and the `create*Tool` factory (for direct use)
- Naming: filename kebab-case, factory PascalCase, entry/key camelCase
- If the tool auto-enables based on an env var, use `enabled: Boolean(process.env["MY_KEY"])` in tools.config.ts
