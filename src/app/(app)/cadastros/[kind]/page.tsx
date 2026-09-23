import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { session } from "@/lib/session";
import { catalogFields, type Catalog } from "@/lib/domain";
import { Heading, Notice, Pagination, pageNumber } from "@/components/ui";
import { saveCatalog } from "@/app/actions";
export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{
    page?: string;
    edit?: string;
    q?: string;
    erro?: string;
  }>;
}) {
  const { kind } = await params;
  if (!Object.hasOwn(catalogFields, kind)) notFound();
  const config = catalogFields[kind];
  const p = await searchParams;
  const page = pageNumber(p.page);
  const { db, admin } = await session();
  const q = (p.q ?? "").slice(0, 100);
  let query = db
    .from("os_catalogs")
    .select("id,legacy_id,kind,name,data,active", { count: "exact" })
    .eq("kind", kind)
    .order("name")
    .range((page - 1) * 25, page * 25 - 1);
  if (q) query = query.ilike("name", `%${q.replace(/[%_\\]/g, "")}%`);
  const { data, error, count } = await query;
  if (error) throw new Error("Falha ao consultar cadastros");
  const edit =
    admin && p.edit && z.uuid().safeParse(p.edit).success
      ? await db
          .from("os_catalogs")
          .select("id,legacy_id,kind,name,data,active")
          .eq("id", p.edit)
          .eq("kind", kind)
          .single()
      : null;
  if (edit?.error) throw new Error("Cadastro indisponível");
  const item = edit?.data as Catalog | undefined;
  return (
    <>
      <Heading
        title={config.label}
        description="Cadastros de apoio às ordens de serviço."
      />
      <Notice error={p.erro} />
      <form className="filters">
        <label>
          Buscar
          <input name="q" defaultValue={q} />
        </label>
        <button>Buscar</button>
      </form>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome / descrição</th>
              {config.fields.slice(0, 3).map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
              <th>Situação</th>
              {admin && <th>Ação</th>}
            </tr>
          </thead>
          <tbody>
            {(data as Catalog[])?.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                {config.fields.slice(0, 3).map(([key]) => (
                  <td key={key}>{c.data[key] ?? ""}</td>
                ))}
                <td>{c.active ? "Ativo" : "Inativo"}</td>
                {admin && (
                  <td>
                    <Link href={`/cadastros/${kind}?edit=${c.id}`}>Editar</Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={page}
          total={count ?? 0}
          base={`/cadastros/${kind}?q=${encodeURIComponent(q)}`}
        />
      </section>
      {admin && (
        <section className="card">
          <h2>{item ? "Editar registro" : "Novo registro"}</h2>
          <form
            key={item?.id ?? "new"}
            action={saveCatalog}
            className="form-grid"
          >
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={item?.id ?? ""} />
            <label className="span-2">
              Nome / descrição
              <input
                name="name"
                defaultValue={item?.name ?? ""}
                required
                maxLength={500}
              />
            </label>
            {config.fields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  name={key}
                  defaultValue={item?.data[key] ?? ""}
                  maxLength={2000}
                  type={key === "link" ? "url" : "text"}
                />
              </label>
            ))}
            <label className="checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={item?.active ?? true}
              />
              Registro ativo
            </label>
            <div>
              <button>Salvar registro</button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
