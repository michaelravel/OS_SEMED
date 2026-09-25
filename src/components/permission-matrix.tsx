"use client";

import { useMemo, useState } from "react";
import { saveAccessProfilePermissions } from "@/app/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";

type PermissionOption = {
  id: string;
  key: string;
  module: string;
  action: string;
  description: string;
};

const moduleLabels: Record<string, string> = {
  dashboard: "Painel",
  orders: "Ordens de Serviço",
  units: "Unidades",
  logistics: "Logística",
  routes: "Rotas",
  vehicles: "Veículos",
  drivers: "Motoristas",
  professionals: "Profissionais",
  audit: "Auditoria",
};

const actionLabels: Record<string, string> = {
  view: "Visualizar",
  create: "Incluir",
  update: "Alterar",
  delete: "Excluir",
  manage: "Administrar",
  triage: "Triar",
  forward: "Encaminhar",
  assign: "Atribuir",
  reassign: "Reatribuir",
  attend: "Iniciar atendimento",
  wait_information: "Aguardar informação",
  resume: "Retomar",
  complete: "Concluir",
  cancel: "Cancelar",
  reopen: "Reabrir",
};

const orderOperationActions = new Set([
  "triage",
  "forward",
  "assign",
  "reassign",
  "attend",
  "wait_information",
  "resume",
  "complete",
  "cancel",
  "reopen",
]);

const sensitivePermissions = new Set([
  "professionals.delete",
  "professionals.manage",
  "orders.assign",
  "orders.reassign",
  "orders.complete",
  "orders.cancel",
  "orders.reopen",
]);

function sameSelection(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  return [...left].every((permission) => right.has(permission));
}

export function PermissionMatrix({
  profileId,
  profileName,
  permissions,
  selectedPermissionKeys,
}: {
  profileId: string;
  profileName: string;
  permissions: PermissionOption[];
  selectedPermissionKeys: string[];
}) {
  const initial = useMemo(
    () => new Set(selectedPermissionKeys),
    [selectedPermissionKeys],
  );
  const [selected, setSelected] = useState(() => new Set(initial));
  const changed = !sameSelection(initial, selected);
  const modules = useMemo(() => {
    const grouped = new Map<string, PermissionOption[]>();
    for (const permission of permissions) {
      const entries = grouped.get(permission.module) ?? [];
      entries.push(permission);
      grouped.set(permission.module, entries);
    }
    return [...grouped.entries()];
  }, [permissions]);

  function togglePermission(key: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function setModule(modulePermissions: PermissionOption[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const permission of modulePermissions) {
        if (checked) next.add(permission.key);
        else next.delete(permission.key);
      }
      return next;
    });
  }

  function hasSensitiveChanges() {
    return [...sensitivePermissions].some(
      (permission) => initial.has(permission) !== selected.has(permission),
    );
  }

  return (
    <form
      action={saveAccessProfilePermissions}
      onSubmit={(event) => {
        if (!changed) {
          event.preventDefault();
          return;
        }
        if (
          hasSensitiveChanges() &&
          !window.confirm(
            `Confirmar alterações sensíveis nas permissões do perfil “${profileName}”?`,
          )
        )
          event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={profileId} />
      {[...selected].map((key) => (
        <input
          key={key}
          type="hidden"
          name="permission_keys"
          value={key}
        />
      ))}

      <div className="permission-matrix">
        {modules.map(([module, modulePermissions]) => {
          const generalPermissions = modulePermissions.filter(
            (permission) => !orderOperationActions.has(permission.action),
          );
          const operationPermissions = modulePermissions.filter((permission) =>
            orderOperationActions.has(permission.action),
          );
          const selectedInModule = modulePermissions.filter((permission) =>
            selected.has(permission.key),
          ).length;

          const options = (items: PermissionOption[]) =>
            items.map((permission) => (
              <label className="permission-option" key={permission.id}>
                <input
                  type="checkbox"
                  checked={selected.has(permission.key)}
                  onChange={(event) =>
                    togglePermission(permission.key, event.target.checked)
                  }
                />
                <span>
                  <strong>
                    {actionLabels[permission.action] ?? permission.action}
                  </strong>
                  <small>{permission.description}</small>
                </span>
              </label>
            ));

          return (
            <fieldset key={module}>
              <legend>{moduleLabels[module] ?? module}</legend>
              <div className="permission-module-head">
                <span>
                  {selectedInModule} de {modulePermissions.length} selecionadas
                </span>
                <div>
                  <button
                    className="secondary small"
                    type="button"
                    onClick={() => setModule(modulePermissions, true)}
                    disabled={selectedInModule === modulePermissions.length}
                  >
                    Selecionar todas
                  </button>
                  <button
                    className="secondary small"
                    type="button"
                    onClick={() => setModule(modulePermissions, false)}
                    disabled={selectedInModule === 0}
                  >
                    Desmarcar todas
                  </button>
                </div>
              </div>
              {generalPermissions.length > 0 && (
                <div className="permission-group">
                  {module === "orders" && <h3>Permissões gerais</h3>}
                  {options(generalPermissions)}
                </div>
              )}
              {operationPermissions.length > 0 && (
                <div className="permission-group order-operations">
                  <h3>Operações da OS</h3>
                  {options(operationPermissions)}
                </div>
              )}
            </fieldset>
          );
        })}
      </div>

      <div className="permission-save-bar">
        <p
          className={changed ? "unsaved-changes" : "muted"}
          role="status"
          aria-live="polite"
        >
          {changed
            ? "Existem alterações não salvas."
            : "Nenhuma alteração pendente."}
        </p>
        <div>
          <button
            className="secondary"
            type="button"
            disabled={!changed}
            onClick={() => setSelected(new Set(initial))}
          >
            Cancelar alterações
          </button>
          <ActionSubmitButton
            pendingLabel="Salvando permissões..."
            disabled={!changed}
          >
            Salvar permissões
          </ActionSubmitButton>
        </div>
      </div>
    </form>
  );
}
