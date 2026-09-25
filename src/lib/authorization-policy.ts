import type { PermissionKey } from "./authorization-core";
import type { CatalogKind } from "./domain";

export const routePermissions = {
  dashboard: "dashboard.view",
  orders: "orders.view",
  newOrder: "orders.create",
  units: "units.view",
  professionals: "professionals.view",
  accessProfiles: "professionals.manage",
  audit: "audit.view",
} as const satisfies Record<string, PermissionKey>;

export const orderActionPermissions = {
  CREATE: "orders.create",
  RECONCILE: "orders.update",
  TRIAGE: "orders.triage",
  FORWARD: "orders.forward",
  ASSIGN: "orders.assign",
  REASSIGN: "orders.reassign",
  START_SERVICE: "orders.attend",
  ADD_SERVICE_ENTRY: "orders.attend",
  WAIT_INFORMATION: "orders.wait_information",
  RESUME: "orders.resume",
  COMPLETE: "orders.complete",
  CANCEL: "orders.cancel",
  REOPEN: "orders.reopen",
  EDIT: "orders.update",
  ADD_MESSAGE: "orders.view",
  UPLOAD_ATTACHMENT: "orders.view",
} as const satisfies Record<string, PermissionKey>;

export const administrationActionPermissions = {
  CREATE_UNIT: "units.create",
  UPDATE_UNIT: "units.update",
  VIEW_PROFESSIONAL: "professionals.view",
  CREATE_PROFESSIONAL: "professionals.create",
  UPDATE_PROFESSIONAL: "professionals.update",
  DELETE_PROFESSIONAL: "professionals.delete",
  MANAGE_PROFESSIONAL: "professionals.manage",
} as const satisfies Record<string, PermissionKey>;

export function catalogPermission(
  kind: CatalogKind,
  action: "view" | "create" | "update",
): PermissionKey {
  return `${kind}.${action}`;
}

export function legacyStatusPermission(status: string): PermissionKey {
  if (status === "Aberta") return orderActionPermissions.REOPEN;
  if (status.includes("Aguardando"))
    return orderActionPermissions.WAIT_INFORMATION;
  if (status === "Em execução" || status === "Em atendimento")
    return orderActionPermissions.START_SERVICE;
  if (status === "Concluída") return orderActionPermissions.COMPLETE;
  if (status === "Cancelada") return orderActionPermissions.CANCEL;
  return orderActionPermissions.TRIAGE;
}
