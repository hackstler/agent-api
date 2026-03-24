import type { PendingActionStore, CreatePendingAction } from "../../domain/ports/pending-action-store.js";
import type { ActionExecutor, ActionResult } from "../../domain/ports/action-executor.js";
import { NotFoundError, ForbiddenError } from "../../domain/errors/index.js";

/**
 * Orchestrates the Human-in-the-Loop (HITL) flow:
 * 1. Tools call createPendingAction() to register an action needing approval.
 * 2. Channel adapters present it to the user.
 * 3. The user approves/rejects via POST /actions/:actionId/resolve.
 * 4. resolve() looks up the correct ActionExecutor and runs it.
 */
export class ActionManager {
  constructor(
    private readonly store: PendingActionStore,
    private readonly executors: Map<string, ActionExecutor>,
  ) {}

  createPendingAction(params: CreatePendingAction): string {
    return this.store.save(params);
  }

  async resolve(actionId: string, approved: boolean, userId: string): Promise<ActionResult> {
    const action = this.store.take(actionId);
    if (!action) {
      throw new NotFoundError("Action", actionId);
    }

    if (action.userId !== userId) {
      throw new ForbiddenError("Not authorized to resolve this action");
    }

    if (!approved) {
      return { success: true, message: "Acción cancelada." };
    }

    const executor = this.executors.get(action.actionType);
    if (!executor) {
      throw new Error(`No executor registered for action type: ${action.actionType}`);
    }

    return executor.execute({ userId: action.userId, orgId: action.orgId, action });
  }
}
