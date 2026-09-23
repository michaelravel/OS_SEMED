import { createHash } from "node:crypto";
export function stableId(scope, key) {
  const hex = createHash("sha256").update(`${scope}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function sourceKey(row, index) {
  return `${row["Row ID"] || row.ID || "row"}:${index + 1}`;
}
export function mapSeed(seed) {
  const warnings = [];
  const original = [];
  for (const [table, rows] of Object.entries(seed))
    rows.forEach((row, i) =>
      original.push({
        source: `seed/${table}`,
        source_id: sourceKey(row, i),
        payload: row,
      }),
    );
  const units = (seed.UNIDADES ?? []).map((r, i) => ({
    id: stableId("units", sourceKey(r, i)),
    legacy_id: sourceKey(r, i),
    name: r["NOME DA UNIDADE"] || `Unidade importada ${i + 1}`,
    type: r.TIPO || "",
    address: r["ENDEREÇO UNIDADE"] || "",
    coordinates: r.LATLONG || "",
    active: true,
  }));
  const configs = {
    LOGISTICA: [
      "logistics",
      (r) =>
        [
          r["Área de solicitação"],
          r["Natureza da atividade"],
          r["Tipo de atividade"],
          r["Descrição da atividade"],
        ]
          .filter(Boolean)
          .join(" · "),
      {
        area: "Área de solicitação",
        nature: "Natureza da atividade",
        type: "Tipo de atividade",
        description: "Descrição da atividade",
        detail: "Detalhamento da atividade",
        options: "OPCOES",
        reminder: "lembrete",
      },
    ],
    ROTAS: [
      "routes",
      (r) => r.ROTA,
      { routeId: "ID ROTA", number: "Nº ROTA", link: "LINK" },
    ],
    VEICULOS: [
      "vehicles",
      (r) => r.ID_PLACA,
      { plate: "ID_PLACA", model: "MODELO / TIPO", seats: "Nº DE PASSAGEIROS" },
    ],
    MOTORISTAS: ["drivers", (r) => r["NOME DO MOTORISTA"], { driverId: "ID" }],
  };
  const catalogs = [];
  for (const [table, [kind, name, fields]] of Object.entries(configs)) {
    (seed[table] ?? []).forEach((r, i) =>
      catalogs.push({
        id: stableId(kind, sourceKey(r, i)),
        legacy_id: sourceKey(r, i),
        kind,
        name: String(name(r) || `Registro ${i + 1}`).slice(0, 500),
        data: Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, String(r[v] ?? "")]),
        ),
        active: true,
      }),
    );
  }
  const orders = (seed.ABERTURA_OS ?? []).map((r, i) => {
    const matches = units.filter((u) => u.name === r.ESTABELECIMENTO);
    const id = stableId("orders", sourceKey(r, i));
    if (matches.length !== 1)
      warnings.push({
        id,
        reason: "Unidade ausente ou ambígua; mantida sem vínculo",
      });
    warnings.push({
      id,
      reason:
        "Status, autoria e responsável exigem conciliação; nenhuma conta foi inferida",
    });
    let opened_at = null;
    const serial = Number(r["DATA DE ABERTURA"]);
    if (Number.isFinite(serial) && serial > 0 && serial < 100000)
      opened_at = new Date(
        Math.round((serial - 25569) * 86400000),
      ).toISOString();
    return {
      id,
      legacy_id: sourceKey(r, i),
      unit_id: matches.length === 1 ? matches[0].id : null,
      opened_by: null,
      responsible_id: null,
      category_id: null,
      title: String(
        r["DESCRIÇÃO DA ATIVIDADE"] ||
          r["TIPO DE ATIVIDADE"] ||
          `OS ${r.ID || i + 1}`,
      ).slice(0, 500),
      status: "A conferir",
      details: Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, String(v ?? "")]),
      ),
      opened_at,
      active: true,
    };
  });
  return { units, catalogs, orders, original, warnings };
}
