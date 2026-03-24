import type { PendingAction, PendingActionStore, CreatePendingAction } from "../../domain/ports/pending-action-store.js";

/**
 * In-memory pending action store with auto-expiry.
 *
 * Suitable for single-process deployments. For multi-instance,
 * swap with a Drizzle-backed implementation (same port interface).
 */
export class InMemoryActionStore implements PendingActionStore {
  private readonly actions = new Map<string, PendingAction>();
  private counter = 0;

  save(params: CreatePendingAction): string {
    this.purgeExpired();

    const id = `action-${++this.counter}`;
    const action: PendingAction = {
      ...params,
      id,
      createdAt: new Date(),
    };
    this.actions.set(id, action);
    return id;
  }

  take(actionId: string): PendingAction | null {
    const action = this.actions.get(actionId);
    if (!action) return null;

    if (new Date() > action.expiresAt) {
      this.actions.delete(actionId);
      return null;
    }

    this.actions.delete(actionId); // one-time use
    return action;
  }

  private purgeExpired(): void {
    const now = new Date();
    for (const [id, action] of this.actions) {
      if (now > action.expiresAt) this.actions.delete(id);
    }
  }
}
