import { editOrderControlled } from "@/app/actions";
import { fieldLimits } from "@/lib/application-config";
import { priorities } from "@/lib/domain";
import type { OrderDetail } from "./types";

export function OrderAdministration({
  id,
  order,
}: {
  id: string;
  order: OrderDetail;
}) {
  return (
    <section className="card">
        <h2>Editar solicitação</h2>
        <form action={editOrderControlled} className="form-grid">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={order.version} />
          <label className="span-2">
            Título
            <input
              name="title"
              required
              minLength={3}
              maxLength={fieldLimits.title}
              defaultValue={order.title}
            />
          </label>
          <label>
            Possui material?
            <select
              name="has_material"
              defaultValue={order.details.has_material ?? "Não informado"}
            >
              <option>Não informado</option>
              <option>Sim</option>
              <option>Não</option>
            </select>
          </label>
          <label>
            Prioridade
            <select name="priority" defaultValue={order.priority} required>
              {priorities.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </label>
          <label>
            Justificativa da prioridade
            <input name="priority_reason" maxLength={2000} />
          </label>
          <label>
            B.O. / REDS
            <input
              name="police_report"
              maxLength={fieldLimits.policeReport}
              defaultValue={order.details.police_report ?? ""}
            />
          </label>
          <label className="span-2">
            Observações
            <textarea
              name="observation"
              maxLength={fieldLimits.observation}
              defaultValue={order.details.observation ?? ""}
            />
          </label>
          <div>
            <button>Salvar alterações</button>
          </div>
        </form>
    </section>
  );
}
