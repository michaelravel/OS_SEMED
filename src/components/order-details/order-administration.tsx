import {
  editOrderControlled,
  updateOrderLinksLegacy,
} from "@/app/actions";
import { fieldLimits } from "@/lib/application-config";
import { priorities } from "@/lib/domain";
import type {
  NamedOption,
  OrderCatalog,
  OrderDetail,
} from "./types";

export function OrderAdministration({
  id,
  order,
  units,
  profiles,
  catalogs,
}: {
  id: string;
  order: OrderDetail;
  units: NamedOption[];
  profiles: NamedOption[];
  catalogs: OrderCatalog[];
}) {
  const peopleFields = [
    ["responsible_id", "Responsável", order.responsible_id],
    ["opened_by", "Solicitante", order.opened_by],
  ] as const;

  return (
    <>
      <section className="card">
        <h2>Vínculos da ordem</h2>
        <p className="muted">
          O responsável e o solicitante devem possuir vínculo ativo com a
          unidade selecionada.
        </p>
        <form action={updateOrderLinksLegacy} className="form-grid">
          <input type="hidden" name="id" value={id} />
          <label>
            Unidade
            <select name="unit_id" defaultValue={order.unit_id ?? ""} required>
              <option value="">Selecione</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Classificação
            <select
              name="category_id"
              defaultValue={order.category_id ?? ""}
              required
            >
              <option value="">Selecione</option>
              {catalogs
                .filter((catalog) => catalog.kind === "logistics")
                .map((catalog) => (
                  <option key={catalog.id} value={catalog.id}>
                    {catalog.name}
                  </option>
                ))}
            </select>
          </label>
          {peopleFields.map(([key, label, value]) => (
            <label key={key}>
              {label}
              <select name={key} defaultValue={value ?? ""}>
                <option value="">Não vinculado</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div>
            <button>Salvar vínculos</button>
          </div>
        </form>
      </section>
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
    </>
  );
}
