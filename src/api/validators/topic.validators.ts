import { z } from "zod";

export const createTopicValidator = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export const updateTopicValidator = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
});

export type CreateTopicInput = z.infer<typeof createTopicValidator>;
export type UpdateTopicInput = z.infer<typeof updateTopicValidator>;
