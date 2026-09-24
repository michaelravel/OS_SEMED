import { addServiceEntry } from "@/app/actions";
import { date } from "@/components/ui";
import {
  serviceEntryTypes,
  workflowLimits,
} from "@/lib/domain";
import type { OrderServiceEntryView } from "./types";

export function OrderService({
  id,
  version,
  entries,
  canAdd,
}: {
  id: string;
  version: number;
  entries: OrderServiceEntryView[];
  canAdd: boolean;
}) {
  if (!canAdd && !entries.length) return null;

  return (
    <section className="card service-records">
      <div className="section-head">
        <div>
          <p className="eyebrow">ATENDIMENTO</p>
          <h2>Registro formal de atendimento</h2>
          <p className="muted">
            Evidências técnicas do serviço executado, separadas das mensagens da
            ordem.
          </p>
        </div>
      </div>
      {canAdd && (
        <details className="workflow-action service-entry-form">
          <summary>Adicionar registro de atendimento</summary>
          <form action={addServiceEntry} className="form-grid">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={version} />
            <label>
              Tipo do registro
              <select name="entry_type" required defaultValue="">
                <option value="">Selecione</option>
                {serviceEntryTypes.map((entryType) => (
                  <option key={entryType} value={entryType}>
                    {entryType.charAt(0).toUpperCase() + entryType.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Data do atendimento
              <input name="serviced_at" type="datetime-local" required />
            </label>
            <label className="span-2">
              Descrição
              <textarea
                name="description"
                required
                minLength={workflowLimits.solutionMin}
                maxLength={workflowLimits.solutionMax}
                rows={4}
              />
            </label>
            <div>
              <button>Registrar atendimento</button>
            </div>
          </form>
        </details>
      )}
      <div className="timeline service-timeline">
        {entries.map((entry) => (
          <article key={entry.id}>
            <strong>
              {entry.entry_type.charAt(0).toUpperCase() + entry.entry_type.slice(1)}
            </strong>
            <small>Atendimento em {date(entry.serviced_at)}</small>
            <p>{entry.description}</p>
          </article>
        ))}
        {!entries.length && (
          <p className="empty">Nenhum atendimento formal registrado.</p>
        )}
      </div>
    </section>
  );
}
