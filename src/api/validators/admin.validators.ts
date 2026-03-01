import { z } from "zod";

export const listUsersValidator = z.object({
  orgId: z.string().optional(),
  search: z.string().optional(),
});

export const createUserValidator = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  orgId: z.string().min(1),
  role: z.enum(["admin", "user"]).default("user"),
});

export const createOrgValidator = z.object({
  orgId: z.string().min(1).max(100),
  adminUsername: z.string().min(3).max(50),
  adminPassword: z.string().min(8),
});

export type ListUsersInput = z.infer<typeof listUsersValidator>;
export type CreateUserInput = z.infer<typeof createUserValidator>;
export type CreateOrgInput = z.infer<typeof createOrgValidator>;
