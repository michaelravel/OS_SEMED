"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldLimits } from "@/lib/application-config";
import { session } from "@/lib/session";
import {
  advanceOrderSchema,
  completeOrderSchema,
  justifyOrderSchema,
  orderSchema,
  orderStatusNames,
  priorities,
  roleNames,
} from "@/lib/domain";
import {
  actionFailed,
  formText,
  requireAdministrator,
} from "./shared";

function refreshOrder(id: string) {
  revalidatePath(`/ordens/${id}`);
  revalidatePath("/ordens");
  revalidatePath("/painel");
}

export async function createOrder(form: FormData) {
  const { db, user } = await session();
  const input = orderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) actionFailed("/ordens/nova");
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
    actionFailed("/ordens/nova");
  const { data: category, error: categoryError } = await db
    .from("os_catalogs")
    .select("id")
    .eq("id", category_id)
    .eq("kind", "logistics")
    .eq("active", true)
    .single();
  if (categoryError || !category) actionFailed("/ordens/nova");
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
      status: orderStatusNames.open,
      opened_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) actionFailed("/ordens/nova");
  revalidatePath("/painel");
  redirect(`/ordens/${data.id}`);
}

export async function changeStatus(form: FormData) {
  const { db } = await session();
  const input = advanceOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) actionFailed("/ordens");
  const { id, status, reason } = input.data;
  const { error } = await db.rpc("os_change_status", {
    target: id,
    next_status: status,
    reason,
  });
  if (error) actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function completeOrder(form: FormData) {
  const { db } = await session();
  const input = completeOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) actionFailed("/ordens");
  const { id, solution } = input.data;
  const { error } = await db.rpc("os_complete_order", { target: id, solution });
  if (error) actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function cancelOrder(form: FormData) {
  const { db } = await session();
  const input = justifyOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) actionFailed("/ordens");
  const { id, justification } = input.data;
  const { error } = await db.rpc("os_cancel_order", { target: id, justification });
  if (error) actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function reopenOrder(form: FormData) {
  const { db } = await session();
  const input = justifyOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) actionFailed("/ordens");
  const { id, justification } = input.data;
  const { error } = await db.rpc("os_reopen_order", { target: id, justification });
  if (error) actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function editOrderDetails(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  const id = z.uuid().parse(formText(form, "id"));
  const input = z
    .object({
      title: z.string().trim().min(3).max(fieldLimits.title),
      observation: z.string().trim().max(fieldLimits.observation),
      has_material: z.enum(["Não informado", "Sim", "Não"]),
      police_report: z.string().trim().max(fieldLimits.policeReport),
      priority: z.enum(priorities),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) actionFailed(`/ordens/${id}`);
  const { data: previous, error: readError } = await db
    .from("os_orders")
    .select("details")
    .eq("id", id)
    .single();
  if (readError || !previous) actionFailed(`/ordens/${id}`);
  const { title, priority, ...details } = input.data;
  const { error } = await db.rpc("os_edit_order", {
    target: id,
    new_title: title,
    new_priority: priority,
    detail_patch: { ...previous.details, ...details },
  });
  if (error) actionFailed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
}

export async function assignOrder(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  const id = z.uuid().parse(formText(form, "id"));
  const unit = z.uuid().parse(formText(form, "unit_id"));
  const responsible = formText(form, "responsible_id");
  const author = formText(form, "opened_by");
  const category = z.uuid().parse(formText(form, "category_id"));
  for (const [value, role] of [
    [responsible, roleNames.responsible],
    [author, roleNames.requester],
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
    if (error || !data?.length) actionFailed(`/ordens/${id}`);
  }
  const { error } = await db.rpc("os_assign_order", {
    target: id,
    target_unit: unit,
    target_responsible: responsible || null,
    target_opened_by: author || null,
    target_category: category,
  });
  if (error) actionFailed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
}

export async function addMessage(form: FormData) {
  const { db, user } = await session();
  const id = z.uuid().parse(formText(form, "id"));
  const body = z
    .string()
    .trim()
    .min(1)
    .max(fieldLimits.message)
    .parse(formText(form, "body"));
  const { error } = await db
    .from("os_messages")
    .insert({ order_id: id, author_id: user.id, body });
  if (error) actionFailed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
}
