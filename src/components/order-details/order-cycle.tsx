import { buildOrderCycle } from "@/lib/domain";
import type { OrderDetail } from "./types";

export function OrderCycle({ order }: { order: OrderDetail }) {
  const cycle = buildOrderCycle(order.status, order.resume_status);

  return (
    <section className="card order-cycle-card" aria-labelledby="order-cycle-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">CICLO DA OS</p>
          <h2 id="order-cycle-title">Andamento</h2>
        </div>
        {cycle.waiting && (
          <span className="cycle-state waiting">Aguardando informação</span>
        )}
        {cycle.completed && (
          <span className="cycle-state completed">Concluída</span>
        )}
        {cycle.canceled && (
          <span className="cycle-state canceled">Cancelada</span>
        )}
        {cycle.pendingReview && (
          <span className="cycle-state review">A conferir</span>
        )}
      </div>
      <ol className="order-cycle">
        {cycle.stages.map((stage, index) => (
          <li className={stage.state} key={stage.key}>
            <span className="cycle-marker" aria-hidden="true">
              {stage.state === "completed" ? "✓" : index + 1}
            </span>
            <span>{stage.label}</span>
          </li>
        ))}
      </ol>
      {cycle.waiting && (
        <div className="cycle-wait-detail">
          <strong>Fluxo temporariamente pausado</strong>
          <span>
            Motivo: {order.waiting_reason ?? "informação complementar"}
          </span>
          {order.waiting_details && <p>{order.waiting_details}</p>}
        </div>
      )}
      {cycle.canceled && (
        <p className="cycle-terminal-message">
          Esta ordem foi cancelada. Consulte o histórico para a justificativa.
        </p>
      )}
    </section>
  );
}
