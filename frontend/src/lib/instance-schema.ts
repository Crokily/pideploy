import { z } from "zod";

export const instanceStatusSchema = z.enum([
  "pending",
  "creating",
  "running",
  "stopped",
  "error",
  "deleted",
]);

export const instanceIdSchema = z.string().trim().min(1, "Invalid instance id");

export const createInstanceSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    model: z.enum(["claude-opus-4.5", "gpt-5.2", "gemini-3-flash"]),
    channel: z.enum(["telegram", "discord", "whatsapp"]),
    botToken: z.string().optional(),
    apiKey: z.string().optional(),
    region: z.string().optional(),
    instanceType: z.string().optional(),
  })
  .strict();

export const updateInstanceSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100).optional(),
    status: instanceStatusSchema.optional(),
    botToken: z.string().optional(),
    apiKey: z.string().optional(),
    config: z.json().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export type CreateInstanceInput = z.infer<typeof createInstanceSchema>;
export type UpdateInstanceInput = z.infer<typeof updateInstanceSchema>;
