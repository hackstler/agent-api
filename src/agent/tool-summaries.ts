import type { ToolCallSummary } from "../domain/entities/index.js";
import type { AgentStep, AgentToolResult } from "./types.js";

/**
 * Extracts human-readable tool summaries from agent execution steps.
 * Used when persisting messages so the LLM has cross-turn memory of tool usage.
 */
export function extractToolSummaries(steps: AgentStep[]): ToolCallSummary[] {
  return steps.flatMap((step) =>
    step.toolResults.map((tr) => ({
      toolName: tr.toolName,
      summary: summarizeToolCall(tr),
    })),
  );
}

/**
 * Builds a single human-readable summary from a tool result.
 * Exported for use in streaming paths where chunks arrive one at a time.
 */
export function summarizeToolCall(tr: AgentToolResult): string {
  const r = tr.result as Record<string, unknown> | undefined;

  // Delegation tools — include nested tool names for context
  if (tr.toolName.startsWith("delegateTo_")) {
    const agentName = tr.toolName.replace("delegateTo_", "");
    const delegation = r as { text?: string; toolResults?: AgentToolResult[] } | undefined;
    const nestedTools = delegation?.toolResults?.map((t) => t.toolName).join(", ");
    return `Delegó a ${agentName}${nestedTools ? ` [${nestedTools}]` : ""}`;
  }

  switch (tr.toolName) {
    case "searchDocuments": {
      const count = (r?.["chunkCount"] as number) ?? 0;
      return `Búsqueda: ${count} resultado${count !== 1 ? "s" : ""}`;
    }
    case "calculateBudget": {
      const filename = r?.["filename"] as string | undefined;
      return filename ? `Presupuesto: ${filename}` : "Presupuesto generado";
    }
    case "saveNote":
      return "Nota guardada";
    case "sendEmail":
      return "Email enviado";
    case "listEmails":
      return "Listado de emails";
    case "readEmail":
      return "Email leído";
    case "searchEmails":
      return "Búsqueda de emails";
    case "listEvents":
      return "Eventos del calendario";
    case "createEvent":
      return "Evento creado";
    case "updateEvent":
      return "Evento actualizado";
    case "deleteEvent":
      return "Evento eliminado";
    case "listCatalog":
    case "listCatalogs":
      return "Catálogo consultado";
    case "listCatalogItems":
      return "Productos consultados";
    case "createCatalog":
      return "Catálogo creado";
    case "addItem":
      return "Producto añadido";
    case "updateItem":
      return "Producto actualizado";
    case "deleteItem":
      return "Producto eliminado";
    case "searchVideos":
      return "Búsqueda de videos";
    case "getVideoDetails":
      return "Detalles de video";
    case "searchWeb":
      return "Búsqueda web";
    default:
      return tr.toolName;
  }
}
