import Link from "next/link";
import { session } from "@/lib/session";
import { Heading, Notice, Pagination, pageNumber } from "@/components/ui";
import { saveUnit } from "@/app/actions";
import { z } from "zod";
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
  const { db, admin } = await session();
  const q = (p.q ?? "").slice(0, 100);
  let query = db
    .from("os_units")
    .select("id,name,type,address,coordinates,active", { count: "exact" })
    .order("name")
    .range((page - 1) * 25, page * 25 - 1);
  if (q) query = query.ilike("name", `%${q.replace(/[%_\\]/g, "")}%`);
  const { data, error, count } = await query;
  if (error) throw new Error("Falha ao consultar unidades");
  const edit =
    admin && p.edit && z.uuid().safeParse(p.edit).success
      ? await db
          .from("os_units")
          .select("id,name,type,address,coordinates,active")
          .eq("id", p.edit)
          .single()
      : null;
  if (edit?.error) throw new Error("Unidade indisponível");
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
              {admin && <th>Ação</th>}
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.type}</td>
                <td>{u.address}</td>
                <td>{u.active ? "Ativa" : "Inativa"}</td>
                {admin && (
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
      {admin && (
        <section className="card">
          <h2>{item ? "Editar unidade" : "Nova unidade"}</h2>
          <form key={item?.id ?? "new"} action={saveUnit} className="form-grid">
            <input type="hidden" name="id" value={item?.id ?? ""} />
            {(
              [
                ["name", "Nome", 300],
                ["type", "Tipo", 200],
                ["address", "Endereço", 1000],
                ["coordinates", "Coordenadas", 100],
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
