import { Hono } from "hono";
import { z } from "zod";
import type { ActionManager } from "../../application/managers/action.manager.js";
import { DomainError } from "../../domain/errors/index.js";

const resolveSchema = z.object({
  approved: z.boolean(),
});

/**
 * Generic HITL action resolution endpoint.
 *
 * Called by the dashboard (button click) or WhatsApp controller (button reply)
 * to approve or reject any pending action. Action-type-agnostic — the
 * ActionManager routes to the correct executor based on actionType.
 */
export function createActionController(actionManager: ActionManager): Hono {
  const router = new Hono();

  /**
   * POST /actions/:actionId/resolve
   * Body: { approved: boolean }
   * Auth: user JWT (mounted behind authMiddleware in app.ts)
   */
  router.post("/:actionId/resolve", async (c) => {
    const { actionId } = c.req.param();
    const user = c.get("user");
    const userId = user?.userId;

    if (!userId) {
      return c.json({ error: "Unauthorized", message: "Missing userId" }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = resolveSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation", message: parsed.error.message }, 400);
    }

    try {
      const result = await actionManager.resolve(actionId, parsed.data.approved, userId);
      return c.json({ data: result });
    } catch (err) {
      if (err instanceof DomainError) throw err; // handled by global error handler
      const message = err instanceof Error ? err.message : "Failed to resolve action";
      return c.json({ error: "InternalError", message }, 500);
    }
  });

  return router;
}
