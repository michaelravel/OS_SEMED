import { notFound } from "next/navigation";
import { z } from "zod";
import { Heading, Notice } from "@/components/ui";
import { OrderActivity } from "@/components/order-details/order-activity";
import { OrderAdministration } from "@/components/order-details/order-administration";
import { OrderAttachments } from "@/components/order-details/order-attachments";
import { OrderSummary } from "@/components/order-details/order-summary";
import { OrderWorkflowActions } from "@/components/order-details/order-workflow-actions";
import { queryLimits } from "@/lib/application-config";
import { roleNames, workflowActionNames } from "@/lib/domain";
import { session } from "@/lib/session";
import { ensureQueriesSucceeded, ensureQuerySucceeded } from "@/lib/errors";
import type {
  OrderCatalog,
  OrderDetail,
  ResponsibleMembershipOption,
} from "@/components/order-details/types";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { db, admin, user } = await session();
  const { data, error } = await db
    .from("os_orders")
    .select(
      "id,protocol,version,title,status,priority,resolution,unit_id,destination_unit_id,opened_by,responsible_id,category_id,driver_id,vehicle_id,route_id,details,opened_at",
    )
    .eq("id", id)
    .maybeSingle();
  ensureQuerySucceeded({ error }, "Falha ao consultar ordem");
  if (!data) notFound();

  const order = data as OrderDetail;
  const [
    messages,
    attachments,
    units,
    profiles,
    catalogs,
    events,
    serviceEntries,
    availableActions,
    attachmentPolicies,
    workflowMemberships,
    collaboration,
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
      .select("id,kind,name")
      .eq("active", true)
      .order("name")
      .limit(queryLimits.lookupRows),
    db
      .from("os_order_events")
      .select("id,from_status,to_status,reason,created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(queryLimits.detailRows),
    db
      .from("os_order_service_entries")
      .select("id,entry_type,description,serviced_at,created_at")
      .eq("order_id", id)
      .order("serviced_at", { ascending: false })
      .limit(queryLimits.detailRows),
    db.rpc("os_order_available_actions", { target: id }),
    db.rpc("os_attachment_policy"),
    admin
      ? db
          .from("os_memberships")
          .select("id,user_id,unit_id,role")
          .eq("active", true)
          .in("role", [roleNames.requester, roleNames.responsible])
          .limit(queryLimits.lookupRows)
      : Promise.resolve({ data: [], error: null }),
    db.rpc("os_order_can_collaborate", { target: id }),
  ]);

  ensureQueriesSucceeded(
    [
      messages,
      attachments,
      units,
      profiles,
      catalogs,
      events,
      serviceEntries,
      availableActions,
      attachmentPolicies,
      workflowMemberships,
      collaboration,
    ],
    "Falha ao consultar detalhes",
  );

  const canPost = collaboration.data === true;
  const unit = units.data?.find((item) => item.id === order.unit_id);
  const catalogRows = (catalogs.data ?? []) as OrderCatalog[];
  const profileName = new Map(
    (profiles.data ?? []).map((profile) => [profile.id, profile.name]),
  );
  const unitName = new Map(
    (units.data ?? []).map((availableUnit) => [
      availableUnit.id,
      availableUnit.name,
    ]),
  );
  const membershipsForWorkflow = workflowMemberships.data ?? [];
  const requesters = Array.from(
    new Map(
      membershipsForWorkflow
        .filter((membership) => membership.role === roleNames.requester)
        .map((membership) => [
          membership.user_id,
          {
            id: membership.user_id,
            name: profileName.get(membership.user_id) ?? "Solicitante",
          },
        ]),
    ).values(),
  );
  const responsibleMemberships = membershipsForWorkflow
    .filter((membership) => membership.role === roleNames.responsible)
    .map(
      (membership): ResponsibleMembershipOption => ({
        id: membership.id,
        user_id: membership.user_id,
        unit_id: membership.unit_id,
        name: `${profileName.get(membership.user_id) ?? "Responsável"} · ${unitName.get(membership.unit_id ?? "") ?? "Unidade não informada"}`,
      }),
    );
  const workflowOperations = availableActions.data ?? [];

  return (
    <>
      <Heading
        title={order.title}
        description={`Protocolo OS-${String(order.protocol).padStart(6, "0")} · ${unit?.name ?? "Unidade aguardando conciliação"}`}
      />
      <Notice error={(await searchParams).erro} />
      <div className="detail-grid">
        <OrderSummary
          order={order}
          catalogs={catalogRows}
        />
        <OrderAttachments
          id={id}
          attachments={attachments.data ?? []}
          policy={attachmentPolicies.data?.[0]}
          canPost={canPost}
        />
      </div>
      <OrderWorkflowActions
        id={id}
        version={order.version}
        actions={workflowOperations}
        units={units.data ?? []}
        requesters={requesters}
        responsibleMemberships={responsibleMemberships}
        catalogs={catalogRows}
      />
      {workflowOperations.some(
        ({ operation }) => operation === workflowActionNames.edit,
      ) && (
        <OrderAdministration
          id={id}
          order={order}
        />
      )}
      <OrderActivity
        id={id}
        userId={user.id}
        events={events.data ?? []}
        serviceEntries={serviceEntries.data ?? []}
        messages={messages.data ?? []}
        canPost={canPost}
      />
    </>
  );
}
