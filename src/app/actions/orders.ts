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
  orderAssignmentSchema,
  orderForwardSchema,
  orderReassignmentSchema,
  orderReconciliationSchema,
  orderSchema,
  orderServiceEntrySchema,
  orderVersionedSchema,
  orderWaitingSchema,
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
  const { db } = await session();
  const input = orderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens/nova");
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
    return actionFailed("/ordens/nova");
  const { data: category, error: categoryError } = await db
    .from("os_catalogs")
    .select("id")
    .eq("id", category_id)
    .eq("kind", "logistics")
    .eq("active", true)
    .single();
  if (categoryError || !category) return actionFailed("/ordens/nova");
  const { data, error } = await db.rpc("os_open_order", {
    order_title: title,
    target_unit: unit_id,
    target_category: category_id,
    order_priority: priority,
    order_details: details,
    target_driver: driver || null,
    target_vehicle: vehicle || null,
    target_route: route || null,
  });
  if (error || !data) return actionFailed("/ordens/nova");
  revalidatePath("/painel");
  redirect(`/ordens/${data}`);
}

export async function reconcileOrder(form: FormData) {
  const { db } = await session();
  const input = orderReconciliationSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, unit_id, opened_by, category_id } = input.data;
  const { error } = await db.rpc("os_reconcile_order", {
    target: id,
    expected_version: version,
    target_unit: unit_id,
    target_opened_by: opened_by,
    target_category: category_id,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function startTriage(form: FormData) {
  const { db } = await session();
  const input = orderVersionedSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version } = input.data;
  const { error } = await db.rpc("os_start_triage", {
    target: id,
    expected_version: version,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function forwardOrder(form: FormData) {
  const { db } = await session();
  const input = orderForwardSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, destination_unit_id } = input.data;
  const { error } = await db.rpc("os_forward_order", {
    target: id,
    expected_version: version,
    destination_unit: destination_unit_id,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function assignOrder(form: FormData) {
  const { db } = await session();
  const input = orderAssignmentSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, responsible_membership_id } = input.data;
  const { error } = await db.rpc("os_assign_order", {
    target: id,
    expected_version: version,
    responsible_membership: responsible_membership_id,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function reassignOrder(form: FormData) {
  const { db } = await session();
  const input = orderReassignmentSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, responsible_membership_id, justification } = input.data;
  const { error } = await db.rpc("os_reassign_order", {
    target: id,
    expected_version: version,
    responsible_membership: responsible_membership_id,
    justification,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function startService(form: FormData) {
  const { db } = await session();
  const input = orderVersionedSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version } = input.data;
  const { error } = await db.rpc("os_start_service", {
    target: id,
    expected_version: version,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function addServiceEntry(form: FormData) {
  const { db } = await session();
  const input = orderServiceEntrySchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, entry_type, description, serviced_at } = input.data;
  const { error } = await db.rpc("os_add_service_entry", {
    target: id,
    expected_version: version,
    entry_kind: entry_type,
    entry_description: description,
    serviced_on: serviced_at,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function waitForInformation(form: FormData) {
  const { db } = await session();
  const input = orderWaitingSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, waitingReason, justification } = input.data;
  const { error } = await db.rpc("os_wait_for_information", {
    target: id,
    expected_version: version,
    wait_reason: waitingReason,
    wait_details: justification,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function resumeService(form: FormData) {
  const { db } = await session();
  const input = orderVersionedSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version } = input.data;
  const { error } = await db.rpc("os_resume_service", {
    target: id,
    expected_version: version,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function changeStatus(form: FormData) {
  const { db } = await session();
  const input = advanceOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, status, reason } = input.data;
  const { error } = await db.rpc("os_change_status", {
    target: id,
    next_status: status,
    reason,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function completeOrder(form: FormData) {
  const { db } = await session();
  const input = completeOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, solution } = input.data;
  const { error } = await db.rpc("os_complete_order", {
    target: id,
    expected_version: version,
    solution,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function cancelOrder(form: FormData) {
  const { db } = await session();
  const input = justifyOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, justification } = input.data;
  const { error } = await db.rpc("os_cancel_order", {
    target: id,
    expected_version: version,
    justification,
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function reopenOrder(form: FormData) {
  const { db } = await session();
  const input = justifyOrderSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, justification } = input.data;
  const { error } = await db.rpc("os_reopen_order", {
    target: id,
    expected_version: version,
    justification,
  });
  if (error) return actionFailed(`/ordens/${id}`);
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
  if (!input.success) return actionFailed(`/ordens/${id}`);
  const { data: previous, error: readError } = await db
    .from("os_orders")
    .select("details")
    .eq("id", id)
    .single();
  if (readError || !previous) return actionFailed(`/ordens/${id}`);
  const { title, priority, ...details } = input.data;
  const { error } = await db.rpc("os_edit_order", {
    target: id,
    new_title: title,
    new_priority: priority,
    detail_patch: { ...previous.details, ...details },
  });
  if (error) return actionFailed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
}

export async function editOrderControlled(form: FormData) {
  const { db } = await session();
  const input = orderVersionedSchema
    .extend({
      title: z.string().trim().min(3).max(fieldLimits.title),
      observation: z.string().trim().max(fieldLimits.observation),
      has_material: z.enum(["Não informado", "Sim", "Não"]),
      police_report: z.string().trim().max(fieldLimits.policeReport),
      priority: z.enum(priorities),
      priority_reason: z.string().trim().max(2_000),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/ordens");
  const { id, version, title, priority, priority_reason, ...details } =
    input.data;
  const { data: previous, error: readError } = await db
    .from("os_orders")
    .select("details")
    .eq("id", id)
    .single();
  if (readError || !previous) return actionFailed(`/ordens/${id}`);
  const { error } = await db.rpc("os_edit_order_controlled", {
    target: id,
    expected_version: version,
    new_title: title,
    new_priority: priority,
    priority_justification: priority_reason,
    detail_patch: { ...previous.details, ...details },
  });
  if (error) return actionFailed(`/ordens/${id}`);
  refreshOrder(id);
}

export async function updateOrderLinksLegacy(form: FormData) {
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
    if (error || !data?.length) return actionFailed(`/ordens/${id}`);
  }
  const { error } = await db.rpc("os_assign_order", {
    target: id,
    target_unit: unit,
    target_responsible: responsible || null,
    target_opened_by: author || null,
    target_category: category,
  });
  if (error) return actionFailed(`/ordens/${id}`);
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
  if (error) return actionFailed(`/ordens/${id}`);
  revalidatePath(`/ordens/${id}`);
}
