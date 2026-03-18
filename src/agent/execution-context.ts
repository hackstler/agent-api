/**
 * Conversation-scoped execution context for human-in-the-loop approval.
 *
 * Keyed by conversationId (persists across turns within the same conversation).
 * Tools register pending actions → controllers read them and ask for confirmation →
 * on the next turn, the controller confirms pending actions before calling the agent.
 *
 * The approval flow is tool-agnostic: any tool with needsApproval registers here,
 * and the controller handles the confirmation loop. Tools never inspect message text.
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

  /** Tool registers an action that needs user approval before execution. */
  registerPending(action: PendingAction): void {
    this.pending.set(action.id, action);
  }

  /** Controller marks an action as approved (before calling the agent on the next turn). */
  confirm(actionId: string): void {
    this.confirmed.add(actionId);
    this.pending.delete(actionId);
  }

  /** Controller marks all pending actions as approved. */
  confirmAll(): void {
    for (const id of this.pending.keys()) {
      this.confirmed.add(id);
    }
    this.pending.clear();
  }

  /** Controller rejects an action. */
  deny(actionId: string): void {
    this.pending.delete(actionId);
  }

  /** Controller rejects all pending actions. */
  denyAll(): void {
    this.pending.clear();
  }

  /** Tool checks if an action was approved. */
  isConfirmed(actionId: string): boolean {
    return this.confirmed.has(actionId);
  }

  /** Controller reads all actions pending user approval. */
  getPending(): PendingAction[] {
    return Array.from(this.pending.values());
  }

  /** Check if there are any pending actions. */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** Clean up confirmed set (after successful execution). */
  clearConfirmed(): void {
    this.confirmed.clear();
  }
}

// ── Registry: conversationId → ExecutionContext ──────────────────────────────

const contexts = new Map<string, ExecutionContext>();
const TTL_MS = 15 * 60 * 1000; // 15 minutes

export function getOrCreateExecutionContext(conversationId: string): ExecutionContext {
  let ctx = contexts.get(conversationId);
  if (!ctx) {
    ctx = new ExecutionContext();
    contexts.set(conversationId, ctx);
    setTimeout(() => contexts.delete(conversationId), TTL_MS);
  }
  return ctx;
}

export function getExecutionContext(conversationId: string): ExecutionContext | undefined {
  return contexts.get(conversationId);
}

export function deleteExecutionContext(conversationId: string): void {
  contexts.delete(conversationId);
}
