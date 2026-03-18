# RAG Pipeline Rules

## Ubicación
El pipeline RAG vive dentro del **plugin RAG**: `src/plugins/rag/pipeline/`.
No es código suelto en `src/rag/` — está encapsulado en el plugin.

## Stack obligatorio
- **Vercel AI SDK** (`ai` package) para orquestación LLM. No usar LangChain JS.
- **pgvector** para búsqueda vectorial. No usar Pinecone, Weaviate ni otros.
- **Drizzle ORM** para queries. SQL raw solo en el retriever (operador `<=>` de pgvector).

## Pipeline — orden estricto
1. Query transformation (si habilitada en `rag.config.ts`)
2. Embedding de la query transformada
3. Retrieval con `retrieve()` o `retrieveMultiQuery()`
4. Reranking (si `enableReranking === true` en config)
5. Context building con `buildContext()`
6. LLM generation (streaming o completo)
7. Persistencia en DB (después de completar la respuesta)

## Embeddings
- **Gemini** `gemini-embedding-001` (768 dims) — modelo principal
- La dimensión del vector debe coincidir con la columna en el schema.
- Si cambias el modelo, actualiza el schema y crea una migración.

## Config del pipeline

Archivo: `src/plugins/rag/config/rag.config.ts`

Valores clave:
- `topK`: 10 (chunks a recuperar)
- `similarityThreshold`: 0.3
- `chunkSize` / `chunkOverlap`: configurable por caso de uso
- `queryEnhancement`: "multi-query" (genera 3 variantes)
- `enableReranking`: false (activar con COHERE_API_KEY)

## Chunking
- No pre-chunkar en el loader. El loader devuelve texto completo, el chunker lo divide.
- Respetar la estrategia definida en `ragConfig.chunkingStrategy`.
- Overlap mínimo 10% del chunk size para continuidad de contexto.
- Estrategias: fixed, semantic, hierarchical (YouTube usa hierarchical).

## Retrieval
- Filtrar chunks de documentos con `status = 'indexed'` solamente.
- Con multi-query: deduplicar por `chunk.id`, mantener el score más alto.
- Búsqueda híbrida: vector similarity + full-text search (tsvector).

## Tools del plugin RAG

Definidas en `src/plugins/rag/tools/`:
- `searchDocuments` — búsqueda RAG en documentos indexados
- `saveNote` — persistir documentos/notas
- `searchWeb` — fallback web via Perplexity (requiere PERPLEXITY_API_KEY)

Habilitación controlada por `src/plugins/rag/config/tools.config.ts`.

## Ingestion

Pipeline en `src/plugins/rag/ingestion/`:
- `loader.ts` — carga archivos/URLs (incluye YouTube via `loaders/youtube.ts`)
- `processor.ts` — chunking + embedding
- `enricher.ts` — enriquecimiento de metadata
- `contextualizer.ts` — prefijos de contexto por chunk

## Persistencia
- Guardar mensajes user + assistant después de completar la respuesta.
- No guardar chunks completos en `messages.metadata`. Solo `chunk.id[]`.
- Actualizar `conversations.updated_at` en cada interacción.

## Errores
- Sin chunks: responder "No encuentro información sobre eso en los documentos disponibles".
- LLM falla: propagar error descriptivo. No reintentar automáticamente.
- Embedding falla: marcar documento como `failed` en DB.
