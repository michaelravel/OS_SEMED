import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  deleteAccessProfile,
  saveAccessProfile,
} from "@/app/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { PermissionMatrix } from "@/components/permission-matrix";
import { Heading } from "@/components/ui";
import { requirePagePermission } from "@/lib/authorization";
import { routePermissions } from "@/lib/authorization-policy";
import { roleNames, roles } from "@/lib/domain";
import { ensureQueriesSucceeded } from "@/lib/errors";
import { session } from "@/lib/session";

const successMessages: Record<string, string> = {
  "perfil-criado": "Perfil criado com sucesso.",
  "perfil-atualizado": "Perfil atualizado com sucesso.",
  "permissoes-atualizadas": "Permissões atualizadas com sucesso.",
  "perfil-excluido": "Perfil excluído com sucesso.",
};

const errorMessages: Record<string, string> = {
  validation: "Revise os campos do perfil e tente novamente.",
  conflict: "O perfil foi alterado. Atualize a página e tente novamente.",
  forbidden: "Seu usuário não possui permissão para administrar perfis.",
  not_found: "O perfil selecionado não foi encontrado.",
  business_rule:
    "A operação não é segura para este perfil. Verifique se ele é de sistema, está em uso ou protege administradores ativos.",
  unexpected: "Não foi possível concluir a operação. Tente novamente.",
};

const roleLabels: Record<string, string> = {
  [roleNames.administrator]: "Administrador",
  [roleNames.manager]: "Gestor",
  [roleNames.requester]: "Solicitante",
  [roleNames.responsible]: "Responsável",
};

export default async function AccessProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{
    perfil?: string;
    erro?: string;
    sucesso?: string;
  }>;
}) {
  const { db, admin } = await session();
  if (!admin) redirect("/sem-acesso");
  await requirePagePermission(routePermissions.accessProfiles, db);
  const query = await searchParams;
  const selectedId = z.uuid().safeParse(query.perfil).success
    ? query.perfil
    : undefined;
  const [profiles, permissions, assignments, memberships] = await Promise.all([
    db
      .from("os_access_profiles")
      .select(
        "id,key,name,description,active,is_system,legacy_role,created_at,updated_at",
      )
      .order("name"),
    db
      .from("os_permissions")
      .select("id,key,module,action,description")
      .order("module")
      .order("action"),
    db
      .from("os_access_profile_permissions")
      .select("access_profile_id,permission_id"),
    db.from("os_memberships").select("access_profile_id"),
  ]);
  ensureQueriesSucceeded(
    [profiles, permissions, assignments, memberships],
    "Falha ao consultar perfis e permissões",
  );

  const rows = profiles.data ?? [];
  const selected = rows.find((profile) => profile.id === selectedId);
  const permissionRows = permissions.data ?? [];
  const selectedPermissionIds = new Set(
    (assignments.data ?? [])
      .filter((item) => item.access_profile_id === selected?.id)
      .map((item) => item.permission_id),
  );
  const permissionCount = new Map<string, number>();
  for (const assignment of assignments.data ?? [])
    permissionCount.set(
      assignment.access_profile_id,
      (permissionCount.get(assignment.access_profile_id) ?? 0) + 1,
    );
  const membershipCount = new Map<string, number>();
  for (const membership of memberships.data ?? [])
    membershipCount.set(
      membership.access_profile_id,
      (membershipCount.get(membership.access_profile_id) ?? 0) + 1,
    );
  const selectedMembershipCount = selected
    ? (membershipCount.get(selected.id) ?? 0)
    : 0;
  return (
    <>
      <Heading
        title="Perfis e Permissões"
        description="Defina o que cada perfil pode fazer. O acesso aos dados continua limitado pelos vínculos, unidades e regras de negócio."
      />

      {query.erro && (
        <p className="notice danger" role="alert">
          {errorMessages[query.erro] ?? errorMessages.unexpected}
        </p>
      )}
      {query.sucesso && successMessages[query.sucesso] && (
        <p className="notice success" role="status">
          {successMessages[query.sucesso]}
        </p>
      )}

      <section className="card table-wrap">
        <div className="section-head">
          <div>
            <h2>Perfis existentes</h2>
            <p className="muted">
              Selecione um perfil para editar seus dados e permissões.
            </p>
          </div>
          <Link className="button small" href="/perfis#editor">
            Novo perfil
          </Link>
        </div>
        {rows.length ? (
          <table>
            <thead>
              <tr>
                <th>Perfil</th>
                <th>Descrição</th>
                <th>Situação</th>
                <th>Permissões</th>
                <th>Tipo</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((profile) => (
                <tr key={profile.id}>
                  <td>
                    <strong>{profile.name}</strong>
                    <small>{roleLabels[profile.legacy_role]}</small>
                  </td>
                  <td>{profile.description || "Sem descrição"}</td>
                  <td>
                    <span
                      className={`badge ${profile.active ? "success" : "danger"}`}
                    >
                      {profile.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td>{permissionCount.get(profile.id) ?? 0}</td>
                  <td>
                    {profile.is_system ? (
                      <span className="badge">Perfil de sistema</span>
                    ) : (
                      "Configurável"
                    )}
                  </td>
                  <td>
                    <Link href={`/perfis?perfil=${profile.id}#editor`}>
                      Abrir matriz →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            <h3>Nenhum perfil cadastrado</h3>
            <p>Crie o primeiro perfil configurável para iniciar a matriz.</p>
          </div>
        )}
      </section>

      <section className="card" id="editor">
        <div className="section-head">
          <div>
            <h2>{selected ? `Editar ${selected.name}` : "Novo perfil"}</h2>
            <p className="muted">
              O papel compatível mantém as regras existentes durante a transição
              para RBAC.
            </p>
          </div>
          {selected && <Link href="/perfis#editor">Criar outro perfil</Link>}
        </div>
        <form
          action={saveAccessProfile}
          className="form-grid"
          key={selected?.id ?? "new-profile"}
        >
          <input type="hidden" name="id" value={selected?.id ?? ""} />
          <label>
            Nome
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={selected?.name ?? ""}
            />
          </label>
          <label>
            Papel compatível
            {selected?.is_system || selectedMembershipCount > 0 ? (
              <>
                <input
                  value={roleLabels[selected?.legacy_role ?? roleNames.requester]}
                  disabled
                />
                <input
                  type="hidden"
                  name="legacy_role"
                  value={selected?.legacy_role ?? roleNames.requester}
                />
              </>
            ) : (
              <select
                name="legacy_role"
                defaultValue={selected?.legacy_role ?? roleNames.requester}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="span-2">
            Descrição
            <textarea
              name="description"
              rows={3}
              maxLength={1000}
              defaultValue={selected?.description ?? ""}
            />
          </label>
          {selected?.is_system ? (
            <>
              <label className="checkbox">
                <input type="checkbox" checked disabled /> Perfil ativo
              </label>
              <input type="hidden" name="active" value="on" />
            </>
          ) : (
            <label className="checkbox">
              <input
                name="active"
                type="checkbox"
                defaultChecked={selected?.active ?? true}
              />
              Perfil ativo
            </label>
          )}
          <div className="profile-form-actions">
            <ActionSubmitButton pendingLabel="Salvando perfil...">
              Salvar perfil
            </ActionSubmitButton>
          </div>
        </form>

        {selected && (
          <div className="profile-safety">
            <p className="muted">
              {selectedMembershipCount} vínculo(s) utilizam este perfil.
            </p>
            {!selected.is_system && selectedMembershipCount === 0 && (
              <form action={deleteAccessProfile}>
                <input type="hidden" name="id" value={selected.id} />
                <ActionSubmitButton
                  className="danger"
                  pendingLabel="Excluindo..."
                  confirmMessage={`Excluir o perfil “${selected.name}”? Esta ação não pode ser desfeita.`}
                >
                  Excluir perfil
                </ActionSubmitButton>
              </form>
            )}
          </div>
        )}
      </section>

      {selected && (
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Matriz de permissões</h2>
              <p className="muted">
                Marque somente as capacidades necessárias para {selected.name}.
              </p>
            </div>
            <span className="badge">
              {selectedPermissionIds.size} permissões salvas
            </span>
          </div>
          <PermissionMatrix
            key={selected.id}
            profileId={selected.id}
            profileName={selected.name}
            permissions={permissionRows}
            selectedPermissionKeys={permissionRows
              .filter((permission) => selectedPermissionIds.has(permission.id))
              .map((permission) => permission.key)}
          />
        </section>
      )}
    </>
  );
}
