import { z } from "zod";
import { permissionKeys } from "./authorization-core";
import { roles } from "./domain";

export const accessProfileSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  legacy_role: z.enum(roles),
  active: z.boolean(),
});

export const accessProfilePermissionsSchema = z.object({
  id: z.uuid(),
  permission_keys: z
    .array(z.enum(permissionKeys))
    .max(permissionKeys.length)
    .refine((keys) => new Set(keys).size === keys.length),
});

export const deleteAccessProfileSchema = z.object({ id: z.uuid() });
