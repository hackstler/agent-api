/**
 * Request-scoped execution context for human-in-the-loop approval.
 *
 * Acts as a shared store (Redux-like) accessible from any point in the agent chain:
 * controller → coordinator → delegation → sub-agent → tool.
 *
 * Tools write pending actions via needsApproval callbacks.
 * Controllers read pending actions after the stream to emit confirmation events.
 *
 * Keyed by requestId (UUID generated per request).
 */

export interface PendingAction {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  createdAt: number;
}

export class ExecutionContext {
  private pending = new Map<string, PendingAction>();
  private confirmed = new Set<string>();

  /** Register an action that needs user approval before execution. */
  registerPending(action: PendingAction): void {
    this.pending.set(action.id, action);
  }

  /** Mark an action as approved by the user. */
  confirm(actionId: string): void {
    this.confirmed.add(actionId);
    this.pending.delete(actionId);
  }

  /** Mark an action as rejected by the user. */
  deny(actionId: string): void {
    this.pending.delete(actionId);
  }

  /** Check if an action was approved. */
  isConfirmed(actionId: string): boolean {
    return this.confirmed.has(actionId);
  }

  /** Get all actions pending user approval. */
  getPending(): PendingAction[] {
    return Array.from(this.pending.values());
  }

  /** Clean up all state. */
  clear(): void {
    this.pending.clear();
    this.confirmed.clear();
  }
}

// ── Registry: requestId → ExecutionContext ────────────────────────────────────

const contexts = new Map<string, ExecutionContext>();
const TTL_MS = 15 * 60 * 1000; // 15 minutes

export function getOrCreateExecutionContext(requestId: string): ExecutionContext {
  let ctx = contexts.get(requestId);
  if (!ctx) {
    ctx = new ExecutionContext();
    contexts.set(requestId, ctx);
    setTimeout(() => contexts.delete(requestId), TTL_MS);
  }
  return ctx;
}

export function getExecutionContext(requestId: string): ExecutionContext | undefined {
  return contexts.get(requestId);
}

export function deleteExecutionContext(requestId: string): void {
  contexts.delete(requestId);
}
