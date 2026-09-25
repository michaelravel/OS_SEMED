import { redirect } from "next/navigation";
import Link from "next/link";
import { session } from "@/lib/session";
import { roleNames, roles } from "@/lib/domain";
import { Heading, Notice, Pagination } from "@/components/ui";
import { pageNumber } from "@/lib/pagination";
import { fieldLimits, queryLimits } from "@/lib/application-config";
import { ensureQueriesSucceeded } from "@/lib/errors";
import {
  prepareProfessionalIdentityChange,
  restoreProfessionalIdentity,
  saveProfessionalMembership,
  deactivateProfessionalMembership,
} from "@/app/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { getUserPermissions, requirePagePermission } from "@/lib/authorization";
import { permissionSetHas } from "@/lib/authorization-core";
import {
  administrationActionPermissions,
  routePermissions,
} from "@/lib/authorization-policy";

export default async function Users({ searchParams }: {
  searchParams: Promise<{ page?: string; edit?: string; erro?: string }>;
}) {
  const { db, admin } = await session();
  if (!admin) redirect("/sem-acesso");
  await requirePagePermission(routePermissions.professionals, db);
  const permissions = await getUserPermissions(db);
  const canCreate = permissionSetHas(
    permissions,
    administrationActionPermissions.CREATE_PROFESSIONAL,
  );
  const canUpdate = permissionSetHas(
    permissions,
    administrationActionPermissions.UPDATE_PROFESSIONAL,
  );
  const canDelete = permissionSetHas(
    permissions,
    administrationActionPermissions.DELETE_PROFESSIONAL,
  );
  const canManage = permissionSetHas(
    permissions,
    administrationActionPermissions.MANAGE_PROFESSIONAL,
  );
  const canSelect = canUpdate || canDelete || canManage;
  const p = await searchParams;
  const page = pageNumber(p.page);
  const [units, memberships] = await Promise.all([
    db.from("os_units").select("id,name").order("name").limit(queryLimits.lookupRows),
    db.rpc("os_professional_memberships", {
      page_size: queryLimits.pageSize,
      page_offset: (page - 1) * queryLimits.pageSize,
    }),
  ]);
  ensureQueriesSucceeded([units, memberships], "Falha ao consultar profissionais");
  const rows = memberships.data ?? [];
  const item = canSelect
    ? rows.find((membership) => membership.membership_id === p.edit)
    : undefined;
  const total = Number(rows[0]?.total_count ?? 0);

  return <>
    <Heading title="Profissionais e vínculos"
      description="Pré-cadastre o e-mail institucional. A identidade Google será vinculada no primeiro acesso confirmado." />
    <Notice error={p.erro} />
    <section className="card table-wrap">
      <table>
        <thead><tr><th>Profissional</th><th>Conta institucional</th><th>Unidade</th><th>Papel</th><th>Situação</th><th>Ação</th></tr></thead>
        <tbody>{rows.map((membership) => <tr key={membership.membership_id ?? membership.professional_id}>
          <td>{membership.professional_name}</td>
          <td>
            {membership.institutional_email ?? "E-mail pendente (legado)"}<br />
            <small className="muted">{membership.identity_linked
              ? "Google vinculado"
              : membership.relink_pending ? "Nova vinculação autorizada" : "Aguardando primeiro acesso"}</small>
          </td>
          <td>{units.data?.find((unit) => unit.id === membership.unit_id)?.name ?? "Secretaria / rede"}</td>
          <td>{membership.role ?? "Sem vínculo"}</td>
          <td>{membership.professional_active && membership.membership_active ? "Ativo" : "Inativo"}</td>
          <td>{canSelect && membership.membership_id && <Link href={`/usuarios?page=${page}&edit=${membership.membership_id}`}>Administrar</Link>}</td>
        </tr>)}</tbody>
      </table>
      <Pagination page={page} total={total} base="/usuarios" />
    </section>

    {((item && canUpdate && (item.role !== roleNames.administrator || canManage)) ||
      (!item && canCreate)) && <section className="card">
      <h2>{item ? "Editar profissional e vínculo" : "Pré-cadastrar profissional"}</h2>
      <p className="muted">Informe o e-mail do Google Workspace. O cadastro não cria senha, convite manual ou identificador técnico no Supabase Auth.</p>
      <form action={saveProfessionalMembership} key={item?.membership_id ?? "new"} className="form-grid">
        <input type="hidden" name="id" value={item?.membership_id ?? ""} />
        <input type="hidden" name="professional_id" value={item?.professional_id ?? ""} />
        <label>E-mail institucional
          <input name="email" type="email" required={!item} readOnly={item?.identity_linked ?? false}
            maxLength={fieldLimits.email} defaultValue={item?.institutional_email ?? ""} autoComplete="email" />
        </label>
        <label>Nome do profissional
          <input name="name" required maxLength={fieldLimits.profileName} defaultValue={item?.professional_name ?? ""} />
        </label>
        <label>Matrícula<input name="registration" maxLength={80} defaultValue={item?.registration ?? ""} /></label>
        <label>Cargo / função<input name="position" maxLength={160} defaultValue={item?.job_title ?? ""} /></label>
        <label>Papel
          <select name="role" defaultValue={item?.role ?? roleNames.requester}>
            {roles
              .filter((role) =>
                canManage || role !== roleNames.administrator,
              )
              .map((role) => <option key={role}>{role}</option>)}
          </select>
        </label>
        <label>Unidade
          <select name="unit_id" defaultValue={item?.unit_id ?? ""}>
            <option value="">Secretaria / rede (admin ou gestor)</option>
            {units.data?.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </label>
        <label className="checkbox"><input name={canDelete ? "professional_active" : undefined} type="checkbox"
          disabled={!canDelete} defaultChecked={item?.professional_active ?? true} />Profissional ativo</label>
        {!canDelete && (item?.professional_active ?? true) && <input type="hidden" name="professional_active" value="on" />}
        <label className="checkbox"><input name={canDelete ? "membership_active" : undefined} type="checkbox"
          disabled={!canDelete} defaultChecked={item?.membership_active ?? true} />Vínculo ativo</label>
        {!canDelete && (item?.membership_active ?? true) && <input type="hidden" name="membership_active" value="on" />}
        <div><button>Salvar cadastro</button></div>
      </form>
    </section>}

    {item?.membership_id && item.membership_active && canDelete &&
      (item.role !== roleNames.administrator || canManage) && <section className="card">
      <h2>Desativar vínculo</h2>
      <p className="muted">O histórico será preservado e o acesso por este vínculo será interrompido.</p>
      <form action={deactivateProfessionalMembership}>
        <input type="hidden" name="membership_id" value={item.membership_id} />
        <ActionSubmitButton className="danger" pendingLabel="Desativando..."
          confirmMessage={`Desativar o vínculo de “${item.professional_name}”?`}>
          Desativar vínculo
        </ActionSubmitButton>
      </form>
    </section>}

    {canManage && item?.identity_linked && <section className="card">
      <h2>Alterar identidade institucional</h2>
      <p className="muted">Esta operação administrativa desvincula a conta atual e autoriza uma conta Google diferente, previamente cadastrada pelo novo e-mail.</p>
      <form action={prepareProfessionalIdentityChange} className="form-grid">
        <input type="hidden" name="professional_id" value={item.professional_id} />
        <label>Novo e-mail institucional<input name="new_email" type="email" required maxLength={fieldLimits.email} /></label>
        <label>Justificativa<textarea name="justification" required minLength={10} maxLength={500} /></label>
        <div><button>Autorizar nova identidade</button></div>
      </form>
    </section>}

    {canManage && item?.relink_pending && <section className="card">
      <h2>Restaurar identidade anterior</h2>
      <form action={restoreProfessionalIdentity} className="form-grid">
        <input type="hidden" name="professional_id" value={item.professional_id} />
        <label className="span-2">Justificativa<textarea name="justification" required minLength={10} maxLength={500} /></label>
        <div><button>Restaurar vínculo anterior</button></div>
      </form>
    </section>}
  </>;
}
