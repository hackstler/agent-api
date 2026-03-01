import { z } from "zod";

export const registerValidator = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  orgId: z.string().optional(),
  role: z.enum(["admin", "user"]).default("user"),
});

export const loginValidator = z.object({
  username: z.string(),
  password: z.string(),
});

export type RegisterInput = z.infer<typeof registerValidator>;
export type LoginInput = z.infer<typeof loginValidator>;
