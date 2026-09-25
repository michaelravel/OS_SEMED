import Link from "next/link";
import { OrderCursorPagination } from "@/components/order-cursor-pagination";
import {
  OrderFilters,
  type OrderFilterOption,
} from "@/components/order-filters";
import { Badge, Heading, date } from "@/components/ui";
import { queryLimits } from "@/lib/application-config";
import { formatOrderProtocol } from "@/lib/domain";
import { ensureQueriesSucceeded } from "@/lib/errors";
import {
  encodeOrderCursor,
  orderFilterUrlParams,
  parseOrderSearchParams,
  type OrderSearchParams,
} from "@/lib/order-search";
import { session } from "@/lib/session";
import { getUserPermissions, requirePagePermission } from "@/lib/authorization";
import { routePermissions } from "@/lib/authorization-policy";
import { Plus } from "lucide-react";

export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<OrderSearchParams>;
}) {
  const parsed = parseOrderSearchParams(await searchParams);
  const { db } = await session();
  await requirePagePermission(routePermissions.orders, db);
  const permissions = await getUserPermissions(db);
  const canCreateOrder = permissions.has(routePermissions.newOrder);
  const [orders, filterOptions] = await Promise.all([
    db.rpc("os_search_orders", {
      ...parsed.args,
      page_size: queryLimits.pageSize,
    }),
    db.rpc("os_order_filter_options"),
  ]);
  ensureQueriesSucceeded([orders, filterOptions], "Falha ao consultar ordens");

  const rows = orders.data ?? [];
  const first = rows[0];
  const last = rows.at(-1);
  const cursorHref = (
    row: (typeof rows)[number],
    direction: "next" | "previous",
  ) => {
    const params = orderFilterUrlParams(parsed.values);
    params.set(
      "cursor",
      encodeOrderCursor({ createdAt: row.created_at, id: row.id }),
    );
    params.set("direction", direction);
    return `/ordens?${params.toString()}`;
  };

  return (
    <>
      <div className="page-heading-actions">
        <Heading
          title="Ordens de serviço"
          description="Consulte e acompanhe as solicitações da rede."
        />
        {canCreateOrder && (
          <Link className="button small" href="/ordens/nova">
            <Plus size={16} /> Nova OS
          </Link>
        )}
      </div>
      <OrderFilters
        values={parsed.values}
        options={(filterOptions.data ?? []) as OrderFilterOption[]}
      />
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Protocolo</th>
              <th>Solicitação</th>
              <th>Situação</th>
              <th>Prioridade</th>
              <th>Registro</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((order) => (
              <tr key={order.id}>
                <td>
                  {formatOrderProtocol(
                    order.protocol,
                    order.protocol_code,
                    order.protocol_year,
                  )}
                </td>
                <td>{order.title}</td>
                <td>
                  <Badge status={order.status} />
                </td>
                <td>{order.priority}</td>
                <td>{date(order.created_at)}</td>
                <td>
                  <Link href={`/ordens/${order.id}`}>Ver detalhes →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">Nenhuma ordem encontrada.</p>}
        <OrderCursorPagination
          pageSize={queryLimits.pageSize}
          previousHref={
            first?.has_previous ? cursorHref(first, "previous") : undefined
          }
          nextHref={last?.has_next ? cursorHref(last, "next") : undefined}
        />
      </section>
    </>
  );
}
