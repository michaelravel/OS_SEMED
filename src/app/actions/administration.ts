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
import {
  actionFailed,
  formText,
  requireActionPermission,
  requireAdministrator,
} from "./shared";
import {
  administrationActionPermissions,
  catalogPermission,
} from "@/lib/authorization-policy";
import {
  allowedGoogleDomains,
  isAllowedGoogleEmail,
  normalizeInstitutionalEmail,
  professionalMembershipSchema,
} from "@/lib/professional-identity";

export async function saveCatalog(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  const kind = formText(form, "kind");
  if (!Object.hasOwn(catalogFields, kind)) throw new Error("Cadastro inválido");
  const catalogKind = kind as keyof typeof catalogFields;
  const id = formText(form, "id");
  if (id) z.uuid().parse(id);
  await requireActionPermission(
    db,
    catalogPermission(catalogKind, id ? "update" : "create"),
    `/cadastros/${catalogKind}`,
    "save_catalog",
  );
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
  await requireActionPermission(
    db,
    id
      ? administrationActionPermissions.UPDATE_UNIT
      : administrationActionPermissions.CREATE_UNIT,
    "/unidades",
    "save_unit",
  );
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
  await requireActionPermission(
    db,
    administrationActionPermissions.MANAGE_PROFESSIONAL,
    "/usuarios",
    "save_membership_legacy",
  );
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

export async function saveProfessionalMembership(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  const input = professionalMembershipSchema.safeParse({
    ...Object.fromEntries(form),
    id: formText(form, "id"),
    professional_id: formText(form, "professional_id"),
  });
  if (!input.success) return actionFailed("/usuarios", "validation", "save_professional");
  if (
    input.data.email &&
    !isAllowedGoogleEmail(input.data.email, allowedGoogleDomains())
  ) return actionFailed("/usuarios", "validation", "save_professional_domain");

  const currentMembership = input.data.id
    ? await db
        .from("os_memberships")
        .select("role")
        .eq("id", input.data.id)
        .maybeSingle()
    : null;
  if (currentMembership?.error)
    return actionFailed("/usuarios", "unexpected", "load_professional");

  await requireActionPermission(
    db,
    !form.has("professional_active") || !form.has("membership_active")
      ? administrationActionPermissions.DELETE_PROFESSIONAL
      : input.data.professional_id
        ? administrationActionPermissions.UPDATE_PROFESSIONAL
        : administrationActionPermissions.CREATE_PROFESSIONAL,
    "/usuarios",
    "save_professional",
  );
  if (
    input.data.role === roleNames.administrator ||
    currentMembership?.data?.role === roleNames.administrator
  )
    await requireActionPermission(
      db,
      administrationActionPermissions.MANAGE_PROFESSIONAL,
      "/usuarios",
      "assign_administrator",
    );

  const { error } = await db.rpc("os_save_professional_membership", {
    target_membership: input.data.id || null,
    target_professional: input.data.professional_id || null,
    professional_email: input.data.email,
    professional_name: input.data.name,
    professional_registration: input.data.registration,
    professional_position: input.data.position,
    target_unit: input.data.unit_id || null,
    target_role: input.data.role,
    professional_active: form.get("professional_active") === "on",
    membership_active: form.get("membership_active") === "on",
  });
  if (error) return actionFailed("/usuarios", "unexpected", "save_professional");
  revalidatePath("/usuarios");
  redirect("/usuarios");
}

export async function deactivateProfessionalMembership(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  const membershipId = z.uuid().safeParse(formText(form, "membership_id"));
  if (!membershipId.success)
    return actionFailed(
      "/usuarios",
      "validation",
      "deactivate_professional_membership",
    );
  await requireActionPermission(
    db,
    administrationActionPermissions.DELETE_PROFESSIONAL,
    "/usuarios",
    "deactivate_professional_membership",
  );
  const { error } = await db.rpc("os_deactivate_professional_membership", {
    target_membership: membershipId.data,
  });
  if (error)
    return actionFailed(
      "/usuarios",
      error.code === "42501" ? "forbidden" : "business_rule",
      "deactivate_professional_membership",
    );
  revalidatePath("/usuarios");
  redirect("/usuarios");
}

export async function prepareProfessionalIdentityChange(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  await requireActionPermission(
    db,
    administrationActionPermissions.MANAGE_PROFESSIONAL,
    "/usuarios",
    "change_professional_identity",
  );
  const input = z.object({
    professional_id: z.uuid(),
    new_email: z.email().max(fieldLimits.email).transform(normalizeInstitutionalEmail),
    justification: z.string().trim().min(10).max(500),
  }).safeParse(Object.fromEntries(form));
  if (!input.success || !isAllowedGoogleEmail(input.data.new_email))
    return actionFailed("/usuarios", "validation", "change_professional_identity");
  const { error } = await db.rpc("os_prepare_professional_identity_change", {
    target_professional: input.data.professional_id,
    new_email: input.data.new_email,
    justification: input.data.justification,
  });
  if (error) return actionFailed("/usuarios", "unexpected", "change_professional_identity");
  revalidatePath("/usuarios");
  redirect("/usuarios");
}

export async function restoreProfessionalIdentity(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  await requireActionPermission(
    db,
    administrationActionPermissions.MANAGE_PROFESSIONAL,
    "/usuarios",
    "restore_professional_identity",
  );
  const input = z.object({
    professional_id: z.uuid(),
    justification: z.string().trim().min(10).max(500),
  }).safeParse(Object.fromEntries(form));
  if (!input.success)
    return actionFailed("/usuarios", "validation", "restore_professional_identity");
  const { error } = await db.rpc("os_restore_professional_identity", {
    target_professional: input.data.professional_id,
    justification: input.data.justification,
  });
  if (error) return actionFailed("/usuarios", "unexpected", "restore_professional_identity");
  revalidatePath("/usuarios");
  redirect("/usuarios");
}
