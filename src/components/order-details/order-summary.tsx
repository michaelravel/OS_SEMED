import { Badge, date } from "@/components/ui";
import type { OrderDetails } from "@/lib/domain";
import type { OrderCatalog, OrderDetail } from "./types";

const detailLabels = {
  observation: "Observações",
  occurred_at: "Data do ocorrido",
  has_material: "Material",
  police_report: "B.O. / REDS",
} satisfies Partial<Record<keyof OrderDetails, string>>;

export function OrderSummary({
  order,
  catalogs,
}: {
  order: OrderDetail;
  catalogs: OrderCatalog[];
}) {
  const catalogName = (value: string) =>
    catalogs.find((catalog) => catalog.id === value)?.name ?? value;
  return (
    <section className="card">
      <div className="section-head">
        <h2>Resumo da solicitação</h2>
        <Badge status={order.status} />
      </div>
      <dl className="details">
        <dt>Abertura</dt>
        <dd>{date(order.opened_at)}</dd>
        <dt>Prioridade</dt>
        <dd>{order.priority}</dd>
        <dt>Classificação</dt>
        <dd>
          {catalogs.find((catalog) => catalog.id === order.category_id)?.name ??
            "Aguardando conciliação"}
        </dd>
        <dt>Motorista</dt>
        <dd>
          {order.driver_id ? catalogName(order.driver_id) : "Não informado"}
        </dd>
        <dt>Veículo</dt>
        <dd>
          {order.vehicle_id ? catalogName(order.vehicle_id) : "Não informado"}
        </dd>
        <dt>Rota</dt>
        <dd>{order.route_id ? catalogName(order.route_id) : "Não informado"}</dd>
        {order.resolution && (
          <>
            <dt>Solução aplicada</dt>
            <dd>{order.resolution}</dd>
          </>
        )}
        {Object.entries(order.details).map(([key, value]) => (
          <div key={key}>
            <dt>{detailLabels[key as keyof typeof detailLabels] ?? key}</dt>
            <dd>{String(value) || "Não informado"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
