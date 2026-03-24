/**
 * Recursively searches a tool result for { pendingAction: true, actionId, actionType, preview }.
 * Handles both direct tool results and nested sub-agent delegation results.
 *
 * Used by: chat.routes.ts, internal.controller.ts, webhook.controller.ts
 */

export interface PendingActionResult {
  actionId: string;
  actionType: string;
  preview: Record<string, unknown>;
}

export function findPendingAction(obj: unknown, depth = 0): PendingActionResult | null {
  if (!obj || typeof obj !== "object" || depth > 5) return null;

  const record = obj as Record<string, unknown>;

  // Direct match: tool result shape
  if (
    record["pendingAction"] === true &&
    typeof record["actionId"] === "string" &&
    typeof record["actionType"] === "string" &&
    record["preview"] &&
    typeof record["preview"] === "object"
  ) {
    return {
      actionId: record["actionId"] as string,
      actionType: record["actionType"] as string,
      preview: record["preview"] as Record<string, unknown>,
    };
  }

  // Recurse into nested objects/arrays (sub-agent delegation wraps results)
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findPendingAction(item, depth + 1);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findPendingAction(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
}
