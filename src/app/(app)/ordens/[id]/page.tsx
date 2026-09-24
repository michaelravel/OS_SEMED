import { notFound } from "next/navigation";
import { z } from "zod";
import { Heading, Notice } from "@/components/ui";
import { OrderActivity } from "@/components/order-details/order-activity";
import { OrderAdministration } from "@/components/order-details/order-administration";
import { OrderAttachments } from "@/components/order-details/order-attachments";
import { OrderSummary } from "@/components/order-details/order-summary";
import { queryLimits } from "@/lib/application-config";
import {
  terminalStatuses,
  roleNames,
  type Catalog,
  type Order,
} from "@/lib/domain";
import { session } from "@/lib/session";
import { ensureQueriesSucceeded, ensureQuerySucceeded } from "@/lib/errors";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { db, admin, user, memberships } = await session();
  const { data, error } = await db
    .from("os_orders")
    .select(
      "id,protocol,legacy_id,title,status,priority,status_reason,resolution,unit_id,opened_by,responsible_id,category_id,driver_id,vehicle_id,route_id,requester_membership_id,responsible_membership_id,import_source,import_source_id,details,created_at,opened_at,completed_at,cancelled_at,reopened_at,active",
    )
    .eq("id", id)
    .maybeSingle();
  ensureQuerySucceeded({ error }, "Falha ao consultar ordem");
  if (!data) notFound();

  const order = data as Order;
  const [
    messages,
    attachments,
    units,
    profiles,
    catalogs,
    events,
    availableActions,
    attachmentPolicies,
  ] = await Promise.all([
    db
      .from("os_messages")
      .select("id,body,created_at,author_id")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(queryLimits.detailRows),
    db
      .from("os_attachments")
      .select("id,name,size_bytes")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(queryLimits.detailRows),
    db
      .from("os_units")
      .select("id,name")
      .order("name")
      .limit(queryLimits.lookupRows),
    admin
      ? db
          .from("os_profiles")
          .select("id,name")
          .order("name")
          .limit(queryLimits.lookupRows)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("os_catalogs")
      .select("id,legacy_id,kind,name,data,active")
      .eq("active", true)
      .order("name")
      .limit(queryLimits.lookupRows),
    db
      .from("os_order_events")
      .select("id,from_status,to_status,reason,created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(queryLimits.detailRows),
    db.rpc("os_order_available_actions", { target: id }),
    db.rpc("os_attachment_policy"),
  ]);

  ensureQueriesSucceeded(
    [
      messages,
      attachments,
      units,
      profiles,
      catalogs,
      events,
      availableActions,
      attachmentPolicies,
    ],
    "Falha ao consultar detalhes",
  );

  const assigned =
    memberships.some(
      (membership) =>
        membership.role === roleNames.responsible &&
        membership.unit_id === order.unit_id,
    ) && order.responsible_id === user.id;
  const closed = terminalStatuses.includes(
    order.status as (typeof terminalStatuses)[number],
  );
  const canPost =
    !closed &&
    (admin ||
      assigned ||
      (order.opened_by === user.id &&
        memberships.some(
          (membership) =>
            membership.role === roleNames.requester &&
            membership.unit_id === order.unit_id,
        )));
  const unit = units.data?.find((item) => item.id === order.unit_id);
  const catalogRows = (catalogs.data ?? []) as Catalog[];

  return (
    <>
      <Heading
        title={order.title}
        description={`Protocolo OS-${String(order.protocol).padStart(6, "0")} · ${unit?.name ?? "Unidade aguardando conciliação"}`}
      />
      <Notice error={(await searchParams).erro} />
      <div className="detail-grid">
        <OrderSummary
          id={id}
          order={order}
          catalogs={catalogRows}
          workflowActions={availableActions.data ?? []}
        />
        <OrderAttachments
          id={id}
          attachments={attachments.data ?? []}
          policy={attachmentPolicies.data?.[0]}
          canPost={canPost}
        />
      </div>
      {admin && (
        <OrderAdministration
          id={id}
          order={order}
          units={units.data ?? []}
          profiles={profiles.data ?? []}
          catalogs={catalogRows}
        />
      )}
      <OrderActivity
        id={id}
        userId={user.id}
        events={events.data ?? []}
        messages={messages.data ?? []}
        canPost={canPost}
      />
    </>
  );
}
