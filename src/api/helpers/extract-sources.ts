import type { AgentStep } from "../../agent/types.js";

/**
 * Extract source chunks from agent tool results.
 * Shared between chat.routes.ts (REST API) and internal.controller.ts (worker API).
 */
export interface ExtractedSource {
  id: string;
  documentTitle: string;
  documentSource: string;
  score: number;
  excerpt: string;
}

export function extractSources(steps: AgentStep[]): ExtractedSource[] {
  const allToolResults = steps.flatMap((s) => s.toolResults);

  const searchResult = allToolResults.find((r) => r.toolName === "searchDocuments");
  if (!searchResult) return [];

  const res = searchResult.result as {
    chunks?: Array<{
      id: string;
      documentTitle: string;
      documentSource: string;
      score: number;
      content: string;
    }>;
  } | undefined;

  return (res?.chunks ?? []).map((c) => ({
    id: c.id,
    documentTitle: c.documentTitle,
    documentSource: c.documentSource,
    score: c.score,
    excerpt: c.content.slice(0, 200) + (c.content.length > 200 ? "\u2026" : ""),
  }));
}
