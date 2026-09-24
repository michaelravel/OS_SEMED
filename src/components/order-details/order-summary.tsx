import {
  cancelOrder,
  changeStatus,
  completeOrder,
  reopenOrder,
} from "@/app/actions";
import { Badge, date } from "@/components/ui";
import {
  workflowLimits,
  orderStatusNames,
  type OrderDetails,
} from "@/lib/domain";
import type { OrderCatalog, OrderDetail, WorkflowAction } from "./types";

const detailLabels = {
  observation: "Observações",
  occurred_at: "Data do ocorrido",
  has_material: "Material",
  police_report: "B.O. / REDS",
} satisfies Partial<Record<keyof OrderDetails, string>>;

export function OrderSummary({
  id,
  order,
  catalogs,
  workflowActions,
}: {
  id: string;
  order: OrderDetail;
  catalogs: OrderCatalog[];
  workflowActions: WorkflowAction[];
}) {
  const catalogName = (value: string) =>
    catalogs.find((catalog) => catalog.id === value)?.name ?? value;
  const nextStatuses = workflowActions.filter(
    (action) => action.operation === "advance",
  );
  const canComplete = workflowActions.some(
    (action) => action.operation === "complete",
  );
  const canCancel = workflowActions.some(
    (action) => action.operation === "cancel",
  );
  const canReopen = workflowActions.some(
    (action) => action.operation === "reopen",
  );

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
      {nextStatuses.length > 0 && (
        <form action={changeStatus} className="filters">
          <input type="hidden" name="id" value={id} />
          <label>
            Situação
            <select name="status" defaultValue="" required>
              <option value="">Selecione a próxima situação</option>
              {nextStatuses.map((action) => (
                <option key={action.next_status}>{action.next_status}</option>
              ))}
            </select>
          </label>
          <label>
            Motivo / observação
            <input name="reason" maxLength={workflowLimits.justificationMax} />
          </label>
          <button>Atualizar status</button>
        </form>
      )}
      {canComplete && (
        <form action={completeOrder}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={order.version} />
          <label>
            Solução aplicada
            <textarea
              name="solution"
              required
              minLength={workflowLimits.solutionMin}
              maxLength={workflowLimits.solutionMax}
              rows={4}
            />
          </label>
          <button>Concluir ordem</button>
        </form>
      )}
      {canCancel && (
        <form action={cancelOrder}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={order.version} />
          <label>
            Justificativa do cancelamento
            <textarea
              name="justification"
              required
              minLength={workflowLimits.justificationMin}
              maxLength={workflowLimits.justificationMax}
              rows={3}
            />
          </label>
          <button>Cancelar ordem</button>
        </form>
      )}
      {canReopen && (
        <form action={reopenOrder}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={order.version} />
          <label>
            Justificativa da reabertura
            <textarea
              name="justification"
              required
              minLength={workflowLimits.justificationMin}
              maxLength={workflowLimits.justificationMax}
              rows={3}
            />
          </label>
          <button>Reabrir ordem</button>
        </form>
      )}
      {order.status === orderStatusNames.pendingReview &&
        workflowActions.length === 0 && (
        <p className="notice">
          Concilie unidade, solicitante e classificação antes de liberar esta
          ordem.
        </p>
      )}
    </section>
  );
}
