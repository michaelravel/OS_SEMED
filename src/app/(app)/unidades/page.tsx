import Link from "next/link";
import { session } from "@/lib/session";
import { Heading, Notice, Pagination } from "@/components/ui";
import { pageNumber, pageRange } from "@/lib/pagination";
import { ensureQuerySucceeded } from "@/lib/errors";
import { fieldLimits } from "@/lib/application-config";
import { saveUnit } from "@/app/actions";
import { z } from "zod";
import { getUserPermissions, requirePagePermission } from "@/lib/authorization";
import { permissionSetHas } from "@/lib/authorization-core";
import {
  administrationActionPermissions,
  routePermissions,
} from "@/lib/authorization-policy";
export default async function Units({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    page?: string;
    erro?: string;
    q?: string;
  }>;
}) {
  const p = await searchParams;
  const page = pageNumber(p.page);
  const range = pageRange(page);
  const { db, admin } = await session();
  await requirePagePermission(routePermissions.units, db);
  const permissions = await getUserPermissions(db);
  const canCreate =
    admin &&
    permissionSetHas(
      permissions,
      administrationActionPermissions.CREATE_UNIT,
    );
  const canUpdate =
    admin &&
    permissionSetHas(
      permissions,
      administrationActionPermissions.UPDATE_UNIT,
    );
  const q = (p.q ?? "").slice(0, 100);
  let query = db
    .from("os_units")
    .select("id,name,type,address,coordinates,active", { count: "exact" })
    .order("name")
    .range(range.from, range.to);
  if (q) query = query.ilike("name", `%${q.replace(/[%_\\]/g, "")}%`);
  const { data, error, count } = await query;
  ensureQuerySucceeded({ error }, "Falha ao consultar unidades");
  const edit =
    canUpdate && p.edit && z.uuid().safeParse(p.edit).success
      ? await db
          .from("os_units")
          .select("id,name,type,address,coordinates,active")
          .eq("id", p.edit)
          .single()
      : null;
  if (edit) ensureQuerySucceeded(edit, "Unidade indisponível");
  const item = edit?.data;
  return (
    <>
      <Heading
        title="Unidades"
        description="Estabelecimentos vinculados ao atendimento da rede."
      />
      <Notice error={p.erro} />
      <form className="filters">
        <label>
          Buscar unidade
          <input name="q" defaultValue={q} />
        </label>
        <button>Buscar</button>
      </form>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Unidade</th>
              <th>Tipo</th>
              <th>Endereço</th>
              <th>Situação</th>
              {canUpdate && <th>Ação</th>}
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.type}</td>
                <td>{u.address}</td>
                <td>{u.active ? "Ativa" : "Inativa"}</td>
                {canUpdate && (
                  <td>
                    <Link href={`/unidades?edit=${u.id}`}>Editar</Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={page}
          total={count ?? 0}
          base={`/unidades?q=${encodeURIComponent(q)}`}
        />
      </section>
      {(item ? canUpdate : canCreate) && (
        <section className="card">
          <h2>{item ? "Editar unidade" : "Nova unidade"}</h2>
          <form key={item?.id ?? "new"} action={saveUnit} className="form-grid">
            <input type="hidden" name="id" value={item?.id ?? ""} />
            {(
              [
                ["name", "Nome", fieldLimits.unitName],
                ["type", "Tipo", fieldLimits.unitType],
                ["address", "Endereço", fieldLimits.unitAddress],
                ["coordinates", "Coordenadas", fieldLimits.coordinates],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key}>
                {label}
                <input
                  name={String(key)}
                  defaultValue={item?.[key] ?? ""}
                  required={key === "name"}
                  maxLength={Number(max)}
                />
              </label>
            ))}
            <label className="checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={item?.active ?? true}
              />
              Unidade ativa
            </label>
            <div>
              <button>Salvar unidade</button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
