import { redirect } from "next/navigation";
import Link from "next/link";
import { session } from "@/lib/session";
import { roleNames, roles } from "@/lib/domain";
import { Heading, Notice, Pagination } from "@/components/ui";
import { pageNumber, pageRange } from "@/lib/pagination";
import { fieldLimits, queryLimits } from "@/lib/application-config";
import { ensureQueriesSucceeded } from "@/lib/errors";
import { saveMembership } from "@/app/actions";
export default async function Users({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; edit?: string; erro?: string }>;
}) {
  const { db, admin } = await session();
  if (!admin) redirect("/painel");
  const p = await searchParams;
  const page = pageNumber(p.page);
  const range = pageRange(page);
  const [units, memberships] = await Promise.all([
    db.from("os_units").select("id,name").order("name").limit(queryLimits.lookupRows),
    db
      .from("os_memberships")
      .select("id,user_id,unit_id,role,active", { count: "exact" })
      .order("id")
      .range(range.from, range.to),
  ]);
  const profileIds = [
    ...new Set((memberships.data ?? []).map((membership) => membership.user_id)),
  ];
  const profiles = profileIds.length
    ? await db
        .from("os_profiles")
        .select("id,name")
        .in("id", profileIds)
        .order("name")
    : { data: [], error: null };
  ensureQueriesSucceeded(
    [profiles, units, memberships],
    "Falha ao consultar vínculos",
  );
  const item = memberships.data?.find((m) => m.id === p.edit);
  return (
    <>
      <Heading
        title="Usuários e vínculos"
        description="Um profissional pode ter funções distintas em diferentes unidades."
      />
      <Notice error={p.erro} />
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Profissional</th>
              <th>Unidade</th>
              <th>Papel</th>
              <th>Situação</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {memberships.data?.map((m) => (
              <tr key={m.id}>
                <td>
                  {profiles.data?.find((p) => p.id === m.user_id)?.name ??
                    m.user_id}
                </td>
                <td>
                  {units.data?.find((u) => u.id === m.unit_id)?.name ??
                    "Secretaria / rede"}
                </td>
                <td>{m.role}</td>
                <td>{m.active ? "Ativo" : "Inativo"}</td>
                <td>
                  <Link href={`/usuarios?page=${page}&edit=${m.id}`}>
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={page}
          total={memberships.count ?? 0}
          base="/usuarios"
        />
      </section>
      <section className="card">
        <h2>{item ? "Editar vínculo" : "Adicionar vínculo"}</h2>
        <p className="muted">
          Cadastre ou convide a conta no Supabase Auth primeiro. Use o
          identificador da conta criada; senhas não são armazenadas neste
          cadastro.
        </p>
        <form
          action={saveMembership}
          key={item?.id ?? "new"}
          className="form-grid"
        >
          <input type="hidden" name="id" value={item?.id ?? ""} />
          <label>
            Identificador da conta (UUID)
            <input
              name="user_id"
              required
              readOnly={Boolean(item)}
              defaultValue={item?.user_id ?? ""}
            />
          </label>
          <label>
            Nome do profissional
            <input
              name="name"
              required
              maxLength={fieldLimits.profileName}
              defaultValue={
                profiles.data?.find((p) => p.id === item?.user_id)?.name ?? ""
              }
            />
          </label>
          <label>
            Papel
            <select
              name="role"
              defaultValue={item?.role ?? roleNames.requester}
            >
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            Unidade
            <select name="unit_id" defaultValue={item?.unit_id ?? ""}>
              <option value="">Secretaria / rede (admin ou gestor)</option>
              {units.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              name="active"
              type="checkbox"
              defaultChecked={item?.active ?? true}
            />
            Vínculo ativo
          </label>
          <div>
            <button>Salvar vínculo</button>
          </div>
        </form>
      </section>
    </>
  );
}
