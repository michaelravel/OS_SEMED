"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldLimits } from "@/lib/application-config";
import {
  catalogFields,
  roleNames,
  roles,
  type CatalogData,
} from "@/lib/domain";
import { session } from "@/lib/session";
import { actionFailed, formText, requireAdministrator } from "./shared";

export async function saveCatalog(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  const kind = formText(form, "kind");
  if (!Object.hasOwn(catalogFields, kind)) throw new Error("Cadastro inválido");
  const catalogKind = kind as keyof typeof catalogFields;
  const id = formText(form, "id");
  if (id) z.uuid().parse(id);
  const name = z.string().trim().min(1).max(fieldLimits.catalogName).parse(formText(form, "name"));
  const data: CatalogData = {};
  for (const [key] of catalogFields[catalogKind].fields)
    data[key] = z.string().trim().max(fieldLimits.catalogValue).parse(formText(form, key));
  if (data.link) {
    const url = z.url().parse(data.link);
    if (!["https:", "http:"].includes(new URL(url).protocol)) return actionFailed(`/cadastros/${catalogKind}`);
  }
  const { error } = await db.rpc("os_save_catalog", {
    target: id || null,
    catalog_kind: catalogKind,
    catalog_name: name,
    catalog_data: data,
    catalog_active: form.get("active") === "on",
  });
  if (error) return actionFailed(`/cadastros/${catalogKind}`);
  revalidatePath(`/cadastros/${catalogKind}`);
  redirect(`/cadastros/${catalogKind}`);
}

export async function saveUnit(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  const id = formText(form, "id");
  if (id) z.uuid().parse(id);
  const input = z.object({
    name: z.string().trim().min(1).max(fieldLimits.unitName),
    type: z.string().max(fieldLimits.unitType),
    address: z.string().max(fieldLimits.unitAddress),
    coordinates: z.string().max(fieldLimits.coordinates),
  }).parse(Object.fromEntries(form));
  const { error } = await db.rpc("os_save_unit", {
    target: id || null,
    unit_name: input.name,
    unit_type: input.type,
    unit_address: input.address,
    unit_coordinates: input.coordinates,
    unit_active: form.get("active") === "on",
  });
  if (error) return actionFailed("/unidades");
  revalidatePath("/unidades");
  redirect("/unidades");
}

export async function saveMembership(form: FormData) {
  const { db, admin, user } = await session();
  requireAdministrator(admin);
  const userId = z.uuid().parse(formText(form, "user_id"));
  const role = z.enum(roles).parse(formText(form, "role"));
  const unit = formText(form, "unit_id");
  if (unit) z.uuid().parse(unit);
  if (
    !unit &&
    role !== roleNames.administrator &&
    role !== roleNames.manager
  )
    return actionFailed("/usuarios");
  if (unit && role === roleNames.administrator) return actionFailed("/usuarios");
  const name = z.string().trim().min(1).max(fieldLimits.profileName).parse(formText(form, "name"));
  const active = form.get("active") === "on";
  if (userId === user.id && !active) return actionFailed("/usuarios");
  const id = formText(form, "id");
  if (id) z.uuid().parse(id);
  const current = id
    ? await db.from("os_memberships").select("id,user_id,role").eq("id", id).single()
    : null;
  if (current?.error) return actionFailed("/usuarios");

  let error: unknown = null;
  if (role === roleNames.administrator) {
    if (!active) {
      if (!id || current?.data.role !== roleNames.administrator)
        return actionFailed("/usuarios");
      ({ error } = await db.rpc("os_revoke_admin", { target: id }));
    } else {
      ({ error } = await db.rpc("os_grant_admin", {
        target_user: userId, target_name: name, replaced_membership: id || null,
      }));
    }
  } else if (current?.data.role === roleNames.administrator) {
    ({ error } = await db.rpc("os_reclassify_admin", {
      target: id, target_unit: unit || null, target_role: role,
      target_active: active, target_name: name,
    }));
  } else {
    ({ error } = await db.rpc("os_save_membership", {
      target: id || null, target_user: userId, target_unit: unit || null,
      target_role: role, target_active: active, target_name: name,
    }));
  }
  if (error) return actionFailed("/usuarios");
  revalidatePath("/usuarios");
  redirect("/usuarios");
}
