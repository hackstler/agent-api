import { z } from "zod";

export const listConversationsValidator = z.object({
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const createConversationValidator = z.object({
  userId: z.string().uuid().optional(),
  title: z.string().optional(),
});

export type ListConversationsInput = z.infer<typeof listConversationsValidator>;
export type CreateConversationInput = z.infer<typeof createConversationValidator>;
