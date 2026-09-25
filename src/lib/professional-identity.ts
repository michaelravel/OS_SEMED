import "server-only";
import { z } from "zod";
import { fieldLimits } from "./application-config";
import {
  normalizeInstitutionalEmail,
} from "./professional-identity-core";
export * from "./professional-identity-core";

export const professionalMembershipSchema = z
  .object({
    id: z.union([z.literal(""), z.uuid()]),
    professional_id: z.union([z.literal(""), z.uuid()]),
    email: z.union([
      z.literal(""),
      z.email().max(fieldLimits.email).transform(normalizeInstitutionalEmail),
    ]),
    name: z.string().trim().min(1).max(fieldLimits.profileName),
    registration: z.string().trim().max(80),
    position: z.string().trim().max(160),
    role: z.enum(["admin", "gestor", "solicitante", "responsavel"]),
    unit_id: z.union([z.literal(""), z.uuid()]),
  })
  .superRefine((value, context) => {
    if (!value.professional_id && !value.email) {
      context.addIssue({
        code: "custom",
        path: ["email"],
        message: "E-mail institucional obrigatório",
      });
    }
    if (
      !value.unit_id &&
      (value.role === "solicitante" || value.role === "responsavel")
    ) {
      context.addIssue({
        code: "custom",
        path: ["unit_id"],
        message: "Unidade obrigatória para o papel",
      });
    }
    if (value.unit_id && value.role === "admin") {
      context.addIssue({
        code: "custom",
        path: ["unit_id"],
        message: "Administrador deve possuir escopo global",
      });
    }
  });

export type ProfessionalMembershipInput = z.infer<
  typeof professionalMembershipSchema
>;
