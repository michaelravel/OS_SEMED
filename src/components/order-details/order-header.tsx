import { Badge } from "@/components/ui";
import {
  canonicalOrderStatusNames,
  formatOrderProtocol,
} from "@/lib/domain";
import type { OrderDetail, OrderHeaderData } from "./types";

export function OrderHeader({
  order,
  header,
}: {
  order: OrderDetail;
  header?: OrderHeaderData;
}) {
  const protocol = formatOrderProtocol(
    order.protocol,
    order.protocol_code,
    order.protocol_year,
  );

  return (
    <>
      <header className="order-header card">
        <div className="order-header-title">
          <div>
            <p className="eyebrow">ORDEM DE SERVIÇO</p>
            <p className="order-protocol">{protocol}</p>
            <h1>{order.title}</h1>
          </div>
          <div className="order-header-badges">
            <Badge status={order.status} />
            <span className="badge">Prioridade {order.priority}</span>
          </div>
        </div>
        <dl className="order-header-meta">
          <div>
            <dt>Categoria</dt>
            <dd>{header?.category_name ?? "Aguardando conciliação"}</dd>
          </div>
          <div>
            <dt>Solicitante</dt>
            <dd>{header?.requester_name ?? "Aguardando conciliação"}</dd>
          </div>
          <div>
            <dt>Unidade de origem</dt>
            <dd>{header?.origin_unit_name ?? "Aguardando conciliação"}</dd>
          </div>
          <div>
            <dt>Unidade executora</dt>
            <dd>{header?.destination_unit_name ?? "Ainda não encaminhada"}</dd>
          </div>
          <div>
            <dt>Responsável</dt>
            <dd>
              {header?.responsible_name ??
                (order.responsible_id
                  ? "Equipe responsável atribuída"
                  : "Ainda não atribuído")}
            </dd>
          </div>
        </dl>
      </header>
      {order.status === canonicalOrderStatusNames.pendingReview && (
        <div className="order-review-alert" role="status">
          <strong>OS aguardando conferência</strong>
          <span>
            Os dados importados precisam ser conciliados antes que o atendimento
            possa avançar.
          </span>
        </div>
      )}
    </>
  );
}
