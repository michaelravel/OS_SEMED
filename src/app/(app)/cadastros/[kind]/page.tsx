import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { session } from "@/lib/session";
import { catalogFields, isCatalogKind, type Catalog } from "@/lib/domain";
import { Heading, Notice, Pagination } from "@/components/ui";
import { pageNumber, pageRange } from "@/lib/pagination";
import { ensureQuerySucceeded } from "@/lib/errors";
import { fieldLimits } from "@/lib/application-config";
import { saveCatalog } from "@/app/actions";
import { getUserPermissions, requirePagePermission } from "@/lib/authorization";
import { permissionSetHas } from "@/lib/authorization-core";
import { catalogPermission } from "@/lib/authorization-policy";
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
  if (!isCatalogKind(kind)) notFound();
  const config = catalogFields[kind];
  const p = await searchParams;
  const page = pageNumber(p.page);
  const range = pageRange(page);
  const { db, admin } = await session();
  await requirePagePermission(catalogPermission(kind, "view"), db);
  const permissions = await getUserPermissions(db);
  const canCreate =
    admin && permissionSetHas(permissions, catalogPermission(kind, "create"));
  const canUpdate =
    admin && permissionSetHas(permissions, catalogPermission(kind, "update"));
  const q = (p.q ?? "").slice(0, 100);
  let query = db
    .from("os_catalogs")
    .select("id,legacy_id,kind,name,data,active", { count: "exact" })
    .eq("kind", kind)
    .order("name")
    .range(range.from, range.to);
  if (q) query = query.ilike("name", `%${q.replace(/[%_\\]/g, "")}%`);
  const { data, error, count } = await query;
  ensureQuerySucceeded({ error }, "Falha ao consultar cadastros");
  const edit =
    canUpdate && p.edit && z.uuid().safeParse(p.edit).success
      ? await db
          .from("os_catalogs")
          .select("id,legacy_id,kind,name,data,active")
          .eq("id", p.edit)
          .eq("kind", kind)
          .single()
      : null;
  if (edit) ensureQuerySucceeded(edit, "Cadastro indisponível");
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
              {canUpdate && <th>Ação</th>}
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
                {canUpdate && (
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
      {(item ? canUpdate : canCreate) && (
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
                maxLength={fieldLimits.catalogName}
              />
            </label>
            {config.fields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  name={key}
                  defaultValue={item?.data[key] ?? ""}
                  maxLength={fieldLimits.catalogValue}
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
