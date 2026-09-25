"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  accessProfilePermissionsSchema,
  accessProfileSchema,
  deleteAccessProfileSchema,
} from "@/lib/access-profiles";
import { session } from "@/lib/session";
import { actionFailed, formText, requireActionPermission } from "./shared";
import { administrationActionPermissions } from "@/lib/authorization-policy";
import type { ActionErrorCode } from "@/lib/action-result";

function profilePath(id?: string) {
  return id ? `/perfis?perfil=${encodeURIComponent(id)}` : "/perfis";
}

function profileErrorCode(error: unknown): ActionErrorCode {
  if (!error || typeof error !== "object") return "unexpected";
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message =
    typeof candidate.message === "string"
      ? candidate.message.toLowerCase()
      : "";
  if (code === "42501" || message.includes("acesso negado"))
    return "forbidden";
  if (message.includes("não encontrado")) return "not_found";
  if (
    code === "23503" ||
    code === "23505" ||
    code === "23514" ||
    message.includes("não pode") ||
    message.includes("deve manter") ||
    message.includes("duplicad") ||
    message.includes("inválid")
  )
    return "business_rule";
  return "unexpected";
}

async function authorizeProfileAdministration(path: string, operation: string) {
  const { db, admin } = await session();
  if (!admin) return actionFailed(path, "forbidden", operation);
  await requireActionPermission(
    db,
    administrationActionPermissions.MANAGE_PROFESSIONAL,
    path,
    operation,
  );
  return db;
}

export async function saveAccessProfile(form: FormData) {
  const parsed = accessProfileSchema.safeParse({
    id: formText(form, "id"),
    name: formText(form, "name"),
    description: formText(form, "description"),
    legacy_role: formText(form, "legacy_role"),
    active: form.get("active") === "on",
  });
  if (!parsed.success)
    return actionFailed("/perfis", "validation", "SAVE_ACCESS_PROFILE");
  const path = profilePath(parsed.data.id || undefined);
  const db = await authorizeProfileAdministration(path, "SAVE_ACCESS_PROFILE");
  const { data, error } = await db.rpc("os_save_access_profile", {
    target: parsed.data.id || null,
    profile_name: parsed.data.name,
    profile_description: parsed.data.description,
    profile_active: parsed.data.active,
    profile_legacy_role: parsed.data.legacy_role,
  });
  if (error || !data)
    return actionFailed(path, profileErrorCode(error), "SAVE_ACCESS_PROFILE");
  revalidatePath("/perfis");
  redirect(
    `/perfis?perfil=${encodeURIComponent(data)}&sucesso=${
      parsed.data.id ? "perfil-atualizado" : "perfil-criado"
    }`,
  );
}

export async function saveAccessProfilePermissions(form: FormData) {
  const parsed = accessProfilePermissionsSchema.safeParse({
    id: formText(form, "id"),
    permission_keys: form.getAll("permission_keys").map(String),
  });
  if (!parsed.success)
    return actionFailed("/perfis", "validation", "SAVE_PROFILE_PERMISSIONS");
  const path = profilePath(parsed.data.id);
  const db = await authorizeProfileAdministration(
    path,
    "SAVE_PROFILE_PERMISSIONS",
  );
  const { error } = await db.rpc("os_set_access_profile_permissions", {
    target: parsed.data.id,
    permission_keys: parsed.data.permission_keys,
  });
  if (error)
    return actionFailed(
      path,
      profileErrorCode(error),
      "SAVE_PROFILE_PERMISSIONS",
    );
  revalidatePath("/perfis");
  redirect(`${path}&sucesso=permissoes-atualizadas`);
}

export async function deleteAccessProfile(form: FormData) {
  const parsed = deleteAccessProfileSchema.safeParse({
    id: formText(form, "id"),
  });
  if (!parsed.success)
    return actionFailed("/perfis", "validation", "DELETE_ACCESS_PROFILE");
  const path = profilePath(parsed.data.id);
  const db = await authorizeProfileAdministration(path, "DELETE_ACCESS_PROFILE");
  const { error } = await db.rpc("os_delete_access_profile", {
    target: parsed.data.id,
  });
  if (error)
    return actionFailed(path, profileErrorCode(error), "DELETE_ACCESS_PROFILE");
  revalidatePath("/perfis");
  redirect("/perfis?sucesso=perfil-excluido");
}
