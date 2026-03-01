import { z } from "zod";

export const listDocumentsValidator = z.object({
  contentType: z.string().optional(),
  search: z.string().optional(),
});

export type ListDocumentsInput = z.infer<typeof listDocumentsValidator>;
