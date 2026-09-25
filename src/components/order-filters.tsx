import Link from "next/link";
import {
  compatibleOrderStatuses,
  priorities,
} from "@/lib/domain";
import type { OrderFilterValues } from "@/lib/order-search";

export type OrderFilterOption = {
  option_kind: string;
  option_id: string;
  option_name: string;
};

function FilterSelect({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: OrderFilterOption[];
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value}>
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.option_id} value={option.option_id}>
            {option.option_name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function OrderFilters({
  values,
  options,
}: {
  values: OrderFilterValues;
  options: OrderFilterOption[];
}) {
  const byKind = (kind: string) =>
    options.filter((option) => option.option_kind === kind);
  const hasAdvancedFilters = Boolean(
    values.category || values.origin || values.destination ||
      values.requester || values.responsible || values.openedFrom ||
      values.openedTo || values.completedFrom || values.completedTo ||
      values.reopened || values.waiting,
  );

  return (
    <form className="card order-filters" action="/ordens" method="get">
      <div className="order-filter-primary">
        <label>
          Busca textual
          <input
            name="q"
            defaultValue={values.q}
            placeholder="Título da solicitação"
            maxLength={100}
          />
        </label>
        <label>
          Protocolo exato
          <input
            name="protocol"
            defaultValue={values.protocol}
            placeholder="OS-000001 ou OS 000001/2026"
            maxLength={50}
          />
        </label>
        <label>
          Situação
          <select name="status" defaultValue={values.status}>
            <option value="">Todas</option>
            {compatibleOrderStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          Prioridade
          <select name="priority" defaultValue={values.priority}>
            <option value="">Todas</option>
            {priorities.map((priority) => (
              <option key={priority}>{priority}</option>
            ))}
          </select>
        </label>
      </div>
      <details className="order-filter-advanced" open={hasAdvancedFilters}>
        <summary>Mais filtros</summary>
        <div className="order-filter-grid">
          <FilterSelect
            label="Categoria"
            name="category"
            value={values.category}
            options={byKind("category")}
          />
          <FilterSelect
            label="Unidade de origem"
            name="origin"
            value={values.origin}
            options={byKind("origin_unit")}
          />
          <FilterSelect
            label="Unidade executora"
            name="destination"
            value={values.destination}
            options={byKind("destination_unit")}
          />
          <FilterSelect
            label="Solicitante"
            name="requester"
            value={values.requester}
            options={byKind("requester")}
          />
          <FilterSelect
            label="Responsável"
            name="responsible"
            value={values.responsible}
            options={byKind("responsible")}
          />
          <label>
            Abertura a partir de
            <input type="date" name="opened_from" defaultValue={values.openedFrom} />
          </label>
          <label>
            Abertura até
            <input type="date" name="opened_to" defaultValue={values.openedTo} />
          </label>
          <label>
            Conclusão a partir de
            <input
              type="date"
              name="completed_from"
              defaultValue={values.completedFrom}
            />
          </label>
          <label>
            Conclusão até
            <input
              type="date"
              name="completed_to"
              defaultValue={values.completedTo}
            />
          </label>
        </div>
        <div className="order-filter-flags">
          <label>
            <input
              type="checkbox"
              name="reopened"
              value="1"
              defaultChecked={values.reopened}
            />
            Somente reabertas
          </label>
          <label>
            <input
              type="checkbox"
              name="waiting"
              value="1"
              defaultChecked={values.waiting}
            />
            Aguardando informação
          </label>
        </div>
      </details>
      <div className="order-filter-actions">
        <button>Aplicar filtros</button>
        <Link href="/ordens">Limpar filtros</Link>
      </div>
    </form>
  );
}
