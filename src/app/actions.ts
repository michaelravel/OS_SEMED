"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase, configured } from "@/lib/supabase";
import { session } from "@/lib/session";
import {
  allowedMimes,
  catalogFields,
  orderSchema,
  roles,
  statuses,
} from "@/lib/domain";

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
  if (configured()) {
    const db = await supabase();
    await db.auth.signOut();
  }
  redirect("/login");
}
export async function createOrder(form: FormData) {
  const { db, user } = await session();
  const input = orderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) failed("/ordens/nova");
  const { title, unit_id, category_id, ...details } = input.data;
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
export async function changeStatus(form: FormData) {
  const { db } = await session();
  const id = z.uuid().parse(text(form, "id"));
  const status = z.enum(statuses).parse(text(form, "status"));
  const { error } = await db.rpc("os_change_status", {
    target: id,
    next_status: status,
  });
  if (error) failed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
  revalidatePath("/painel");
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
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) failed(`/ordens/${id}`);
  const { data: previous, error: readError } = await db
    .from("os_orders")
    .select("details")
    .eq("id", id)
    .single();
  if (readError || !previous) failed(`/ordens/${id}`);
  const { title, ...details } = input.data;
  const { error } = await db
    .from("os_orders")
    .update({ title, details: { ...previous.details, ...details } })
    .eq("id", id);
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
  const { error } = await db
    .from("os_orders")
    .update({
      unit_id: unit,
      responsible_id: responsible || null,
      opened_by: author || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
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
  const { db, user } = await session();
  const orderId = z.uuid().parse(text(form, "id"));
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    file.size < 1 ||
    file.size > 3145728 ||
    !allowedMimes.includes(file.type) ||
    file.name.length > 250
  )
    failed(`/ordens/${orderId}`);
  const id = crypto.randomUUID();
  const path = `${orderId}/${id}`;
  const { error: metaError } = await db.from("os_attachments").insert({
    id,
    order_id: orderId,
    uploaded_by: user.id,
    name: file.name,
    path,
    mime_type: file.type,
    size_bytes: file.size,
  });
  if (metaError) failed(`/ordens/${orderId}`);
  const { error } = await db.storage
    .from("os-attachments")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    await db.from("os_attachments").delete().eq("id", id);
    failed(`/ordens/${orderId}`);
  }
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
  const payload = { name, kind, data, active: form.get("active") === "on" };
  const result = id
    ? await db.from("os_catalogs").update(payload).eq("id", id).eq("kind", kind)
    : await db
        .from("os_catalogs")
        .insert({ ...payload, legacy_id: `NEW-${crypto.randomUUID()}` });
  if (result.error) failed(`/cadastros/${kind}`);
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
  const payload = { ...input, active: form.get("active") === "on" };
  const result = id
    ? await db.from("os_units").update(payload).eq("id", id)
    : await db.from("os_units").insert(payload);
  if (result.error) failed("/unidades");
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
  const { error: profileError } = await db
    .from("os_profiles")
    .upsert({ id: userId, name });
  if (profileError) failed("/usuarios");
  const id = text(form, "id");
  if (id) z.uuid().parse(id);
  const payload = { user_id: userId, unit_id: unit || null, role, active };
  const result = id
    ? await db.from("os_memberships").update(payload).eq("id", id)
    : await db.from("os_memberships").insert(payload);
  if (result.error) failed("/usuarios");
  revalidatePath("/usuarios");
  redirect("/usuarios");
}
