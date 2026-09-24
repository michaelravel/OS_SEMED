"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, configured } from "@/lib/supabase";
import { session } from "@/lib/session";
import {
  advanceOrderSchema,
  catalogFields,
  completeOrderSchema,
  justifyOrderSchema,
  orderSchema,
  priorities,
  roles,
} from "@/lib/domain";
import {
  attachmentBucket,
  attachmentContentMatches,
  attachmentExtensionMatches,
  attachmentMimeTypes,
  attachmentSha256,
  normalizeAttachmentName,
} from "@/lib/attachments";

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "");
}
function failed(path: string): never {
  redirect(`${path}?erro=1`);
}
export async function login(form: FormData) {
  if (!configured()) redirect("/configuracao");
  const input = z
    .object({ email: z.email().max(254), password: z.string().min(1).max(200) })
    .safeParse(Object.fromEntries(form));
  if (!input.success) failed("/login");
  const db = await supabase();
  const { error } = await db.auth.signInWithPassword(input.data);
  if (error) failed("/login");
  redirect("/painel");
}
export async function logout() {
  if (!configured()) redirect("/configuracao");
  const db = await supabase();
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) redirect("/login?logout=erro");
  redirect("/login");
}
export async function createOrder(form: FormData) {
  const { db, user } = await session();
  const input = orderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) failed("/ordens/nova");
  const {
    title,
    unit_id,
    category_id,
    priority,
    driver,
    vehicle,
    route,
    ...details
  } = input.data;
  if (details.occurred_at && !Number.isFinite(Date.parse(details.occurred_at)))
    failed("/ordens/nova");
  const { data: category, error: categoryError } = await db
    .from("os_catalogs")
    .select("id")
    .eq("id", category_id)
    .eq("kind", "logistics")
    .eq("active", true)
    .single();
  if (categoryError || !category) failed("/ordens/nova");
  const { data, error } = await db
    .from("os_orders")
    .insert({
      title,
      unit_id,
      category_id,
      driver_id: driver || null,
      vehicle_id: vehicle || null,
      route_id: route || null,
      priority,
      details,
      opened_by: user.id,
      status: "Aberta",
      opened_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) failed("/ordens/nova");
  revalidatePath("/painel");
  redirect(`/ordens/${data.id}`);
}
function refreshOrder(id: string) {
  revalidatePath(`/ordens/${id}`);
  revalidatePath("/ordens");
  revalidatePath("/painel");
}
export async function changeStatus(form: FormData) {
  const { db } = await session();
  const input = advanceOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) failed("/ordens");
  const { id, status, reason } = input.data;
  const { error } = await db.rpc("os_change_status", {
    target: id,
    next_status: status,
    reason,
  });
  if (error) failed(`/ordens/${id}`);
  refreshOrder(id);
}
export async function completeOrder(form: FormData) {
  const { db } = await session();
  const input = completeOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) failed("/ordens");
  const { id, solution } = input.data;
  const { error } = await db.rpc("os_complete_order", {
    target: id,
    solution,
  });
  if (error) failed(`/ordens/${id}`);
  refreshOrder(id);
}
export async function cancelOrder(form: FormData) {
  const { db } = await session();
  const input = justifyOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) failed("/ordens");
  const { id, justification } = input.data;
  const { error } = await db.rpc("os_cancel_order", {
    target: id,
    justification,
  });
  if (error) failed(`/ordens/${id}`);
  refreshOrder(id);
}
export async function reopenOrder(form: FormData) {
  const { db } = await session();
  const input = justifyOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) failed("/ordens");
  const { id, justification } = input.data;
  const { error } = await db.rpc("os_reopen_order", {
    target: id,
    justification,
  });
  if (error) failed(`/ordens/${id}`);
  refreshOrder(id);
}
export async function editOrderDetails(form: FormData) {
  const { db, admin } = await session();
  if (!admin) throw new Error("Acesso negado");
  const id = z.uuid().parse(text(form, "id"));
  const input = z
    .object({
      title: z.string().trim().min(3).max(500),
      observation: z.string().trim().max(5000),
      has_material: z.enum(["Não informado", "Sim", "Não"]),
      police_report: z.string().trim().max(200),
      priority: z.enum(priorities),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) failed(`/ordens/${id}`);
  const { data: previous, error: readError } = await db
    .from("os_orders")
    .select("details")
    .eq("id", id)
    .single();
  if (readError || !previous) failed(`/ordens/${id}`);
  const { title, priority, ...details } = input.data;
  const { error } = await db.rpc("os_edit_order", {
    target: id,
    new_title: title,
    new_priority: priority,
    detail_patch: { ...previous.details, ...details },
  });
  if (error) failed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
}
export async function assignOrder(form: FormData) {
  const { db, admin } = await session();
  if (!admin) throw new Error("Acesso negado");
  const id = z.uuid().parse(text(form, "id"));
  const unit = z.uuid().parse(text(form, "unit_id"));
  const responsible = text(form, "responsible_id");
  const author = text(form, "opened_by");
  const category = z.uuid().parse(text(form, "category_id"));
  for (const [value, role] of [
    [responsible, "responsavel"],
    [author, "solicitante"],
  ] as const) {
    if (!value) continue;
    z.uuid().parse(value);
    const { data, error } = await db
      .from("os_memberships")
      .select("id")
      .eq("user_id", value)
      .eq("unit_id", unit)
      .eq("role", role)
      .eq("active", true)
      .limit(1);
    if (error || !data?.length) failed(`/ordens/${id}`);
  }
  const { error } = await db.rpc("os_assign_order", {
    target: id,
    target_unit: unit,
    target_responsible: responsible || null,
    target_opened_by: author || null,
    target_category: category,
  });
  if (error) failed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
}
export async function addMessage(form: FormData) {
  const { db, user } = await session();
  const id = z.uuid().parse(text(form, "id"));
  const body = z.string().trim().min(1).max(5000).parse(text(form, "body"));
  const { error } = await db
    .from("os_messages")
    .insert({ order_id: id, author_id: user.id, body });
  if (error) failed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
}
export async function uploadAttachment(form: FormData) {
  const { db } = await session();
  const orderId = z.uuid().parse(text(form, "id"));
  const file = form.get("file");
  const { data: policies, error: policyError } = await db.rpc(
    "os_attachment_policy",
  );
  const policy = policies?.[0];
  if (
    !(file instanceof File) ||
    policyError ||
    !policy ||
    file.size < 1 ||
    file.size > Number(policy.max_file_bytes) ||
    !policy.allowed_mimes.includes(file.type) ||
    !attachmentMimeTypes.includes(file.type)
  )
    failed(`/ordens/${orderId}`);
  const name = normalizeAttachmentName(file.name);
  if (
    !name ||
    !attachmentExtensionMatches(name, file.type) ||
    !(await attachmentContentMatches(file))
  )
    failed(`/ordens/${orderId}`);
  const id = crypto.randomUUID();
  const sha256 = await attachmentSha256(file);
  const { data: path, error: reserveError } = await db.rpc(
    "os_begin_attachment_upload",
    {
      target_order: orderId,
      attachment_id: id,
      original_name: name,
      declared_mime: file.type,
      declared_size: file.size,
      sha256,
    },
  );
  if (reserveError || !path) failed(`/ordens/${orderId}`);
  const { error: uploadError } = await db.storage
    .from(attachmentBucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    await db.rpc("os_abort_attachment_upload", { target: id });
    failed(`/ordens/${orderId}`);
  }
  const { data: completion, error: completionError } = await db.rpc(
    "os_complete_attachment_upload",
    { target: id },
  );
  if (completionError || completion !== "ready") failed(`/ordens/${orderId}`);
  revalidatePath(`/ordens/${orderId}`);
}
export async function saveCatalog(form: FormData) {
  const { db, admin } = await session();
  if (!admin) throw new Error("Acesso negado");
  const kind = text(form, "kind");
  if (!Object.hasOwn(catalogFields, kind)) throw new Error("Cadastro inválido");
  const id = text(form, "id");
  if (id) z.uuid().parse(id);
  const name = z.string().trim().min(1).max(500).parse(text(form, "name"));
  const data: Record<string, string> = {};
  for (const [key] of catalogFields[kind].fields)
    data[key] = z.string().trim().max(2000).parse(text(form, key));
  if (data.link) {
    const url = z.url().parse(data.link);
    if (!["https:", "http:"].includes(new URL(url).protocol))
      failed(`/cadastros/${kind}`);
  }
  const { error } = await db.rpc("os_save_catalog", {
    target: id || null,
    catalog_kind: kind,
    catalog_name: name,
    catalog_data: data,
    catalog_active: form.get("active") === "on",
  });
  if (error) failed(`/cadastros/${kind}`);
  revalidatePath(`/cadastros/${kind}`);
  redirect(`/cadastros/${kind}`);
}
export async function saveUnit(form: FormData) {
  const { db, admin } = await session();
  if (!admin) throw new Error("Acesso negado");
  const id = text(form, "id");
  if (id) z.uuid().parse(id);
  const input = z
    .object({
      name: z.string().trim().min(1).max(300),
      type: z.string().max(200),
      address: z.string().max(1000),
      coordinates: z.string().max(100),
    })
    .parse(Object.fromEntries(form));
  const { error } = await db.rpc("os_save_unit", {
    target: id || null,
    unit_name: input.name,
    unit_type: input.type,
    unit_address: input.address,
    unit_coordinates: input.coordinates,
    unit_active: form.get("active") === "on",
  });
  if (error) failed("/unidades");
  revalidatePath("/unidades");
  redirect("/unidades");
}
export async function saveMembership(form: FormData) {
  const { db, admin, user } = await session();
  if (!admin) throw new Error("Acesso negado");
  const userId = z.uuid().parse(text(form, "user_id"));
  const role = z.enum(roles).parse(text(form, "role"));
  const unit = text(form, "unit_id");
  if (unit) z.uuid().parse(unit);
  if (!unit && !["admin", "gestor"].includes(role)) failed("/usuarios");
  if (unit && role === "admin") failed("/usuarios");
  const name = z.string().trim().min(1).max(200).parse(text(form, "name"));
  const active = form.get("active") === "on";
  if (userId === user.id && !active) failed("/usuarios");
  const id = text(form, "id");
  if (id) z.uuid().parse(id);
  const current = id
    ? await db
        .from("os_memberships")
        .select("id,user_id,role")
        .eq("id", id)
        .single()
    : null;
  if (current?.error) failed("/usuarios");

  let error: unknown = null;
  if (role === "admin") {
    if (!active) {
      if (!id || current?.data.role !== "admin") failed("/usuarios");
      ({ error } = await db.rpc("os_revoke_admin", { target: id }));
    } else {
      ({ error } = await db.rpc("os_grant_admin", {
        target_user: userId,
        target_name: name,
        replaced_membership: id || null,
      }));
    }
  } else if (current?.data.role === "admin") {
    ({ error } = await db.rpc("os_reclassify_admin", {
      target: id,
      target_unit: unit || null,
      target_role: role,
      target_active: active,
      target_name: name,
    }));
  } else {
    ({ error } = await db.rpc("os_save_membership", {
      target: id || null,
      target_user: userId,
      target_unit: unit || null,
      target_role: role,
      target_active: active,
      target_name: name,
    }));
  }
  if (error) failed("/usuarios");
  revalidatePath("/usuarios");
  redirect("/usuarios");
}
