/**
 * Port for executing a confirmed pending action.
 *
 * Each action type (send-email, create-event, etc.) has its own executor.
 * The ActionManager looks up the executor by actionType and calls execute().
 */

import type { PendingAction } from "./pending-action-store.js";

export interface ActionExecutionContext {
  userId: string;
  orgId: string;
  action: PendingAction;
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface ActionExecutor {
  readonly actionType: string;
  execute(ctx: ActionExecutionContext): Promise<ActionResult>;
}
