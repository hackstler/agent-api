/**
 * Generic store for actions pending human confirmation (HITL).
 *
 * Any tool that needs user approval before executing a side-effect
 * (send email, create event, process payment) stores a PendingAction here.
 * Channel adapters present it to the user; the user approves/rejects via
 * POST /actions/:actionId/resolve.
 */

export interface PendingAction {
  id: string;
  userId: string;
  orgId: string;
  conversationId: string;
  actionType: string;
  payload: Record<string, unknown>;
  preview: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

export type CreatePendingAction = Omit<PendingAction, "id" | "createdAt">;

export interface PendingActionStore {
  /** Save a new pending action. Returns the generated action ID. */
  save(action: CreatePendingAction): string;

  /** Retrieve and consume a pending action (one-time use). Returns null if not found or expired. */
  take(actionId: string): PendingAction | null;
}
