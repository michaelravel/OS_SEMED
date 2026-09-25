export const permissionKeys = [
  "dashboard.view",
  "orders.view",
  "orders.create",
  "orders.update",
  "orders.triage",
  "orders.forward",
  "orders.assign",
  "orders.reassign",
  "orders.attend",
  "orders.wait_information",
  "orders.resume",
  "orders.complete",
  "orders.cancel",
  "orders.reopen",
  "units.view",
  "units.create",
  "units.update",
  "logistics.view",
  "logistics.create",
  "logistics.update",
  "routes.view",
  "routes.create",
  "routes.update",
  "vehicles.view",
  "vehicles.create",
  "vehicles.update",
  "drivers.view",
  "drivers.create",
  "drivers.update",
  "professionals.view",
  "professionals.create",
  "professionals.update",
  "professionals.delete",
  "professionals.manage",
  "audit.view",
] as const;

export type PermissionKey = (typeof permissionKeys)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionKeys.includes(value as PermissionKey);
}

export function permissionSetHas(
  permissions: ReadonlySet<PermissionKey>,
  permission: PermissionKey,
) {
  return permissions.has(permission);
}
