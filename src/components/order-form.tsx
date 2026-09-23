"use client";
import { useState } from "react";
import type { Catalog, Unit } from "@/lib/domain";
import { createOrder } from "@/app/actions";
export function OrderForm({
  units,
  categories,
  catalogs,
}: {
  units: Unit[];
  categories: Catalog[];
  catalogs: Catalog[];
}) {
  const [area, setArea] = useState("");
  const [nature, setNature] = useState("");
  const [type, setType] = useState("");
  const unique = (key: string, rows: Catalog[]) =>
    [...new Set(rows.map((c) => c.data[key]).filter(Boolean))].sort();
  const filtered = categories.filter(
    (c) =>
      (!area || c.data.area === area) &&
      (!nature || c.data.nature === nature) &&
      (!type || c.data.type === type),
  );
  return (
    <form action={createOrder} className="card form-grid">
      <label className="span-2">
        Título da solicitação
        <input
          name="title"
          minLength={3}
          maxLength={500}
          required
          placeholder="Descreva brevemente o serviço necessário"
        />
      </label>
      <label>
        Unidade
        <select name="unit_id" required>
          <option value="">Selecione</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Área
        <select
          value={area}
          onChange={(e) => {
            setArea(e.target.value);
            setNature("");
            setType("");
          }}
          required
        >
          <option value="">Selecione</option>
          {unique("area", categories).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Natureza
        <select
          value={nature}
          onChange={(e) => {
            setNature(e.target.value);
            setType("");
          }}
          required
          disabled={!area}
        >
          <option value="">Selecione</option>
          {unique(
            "nature",
            categories.filter((c) => c.data.area === area),
          ).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Tipo
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          required
          disabled={!nature}
        >
          <option value="">Selecione</option>
          {unique(
            "type",
            categories.filter(
              (c) => c.data.area === area && c.data.nature === nature,
            ),
          ).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className="span-2">
        Descrição e detalhamento
        <select
          key={`${area}/${nature}/${type}`}
          name="category_id"
          required
          disabled={!type}
        >
          <option value="">Selecione a classificação</option>
          {filtered.map((c) => (
            <option key={c.id} value={c.id}>
              {[c.data.description, c.data.detail]
                .filter(Boolean)
                .join(" · ") || c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Possui material?
        <select name="has_material">
          <option>Não informado</option>
          <option>Sim</option>
          <option>Não</option>
        </select>
      </label>
      <label>
        Data do ocorrido
        <input type="datetime-local" name="occurred_at" />
      </label>
      {[
        ["drivers", "driver", "Motorista"],
        ["vehicles", "vehicle", "Veículo"],
        ["routes", "route", "Rota"],
      ].map(([kind, name, label]) => (
        <label key={kind}>
          {label}
          <select name={name}>
            <option value="">Não informado</option>
            {catalogs
              .filter((c) => c.kind === kind)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      ))}
      <label>
        B.O. / REDS
        <input name="police_report" maxLength={200} />
      </label>
      <label className="span-2">
        Observações
        <textarea name="observation" maxLength={5000} rows={5} />
      </label>
      <div className="span-2">
        <p className="muted">
          Anexos e mensagens poderão ser adicionados após a abertura. A
          atribuição da equipe será feita pela administração.
        </p>
        <button>Abrir ordem de serviço</button>
      </div>
    </form>
  );
}
