import type { PermissionKey } from "./authorization-core";

export type NavigationItem = {
  id:
    | "dashboard"
    | "orders"
    | "units"
    | "logistics"
    | "routes"
    | "vehicles"
    | "drivers"
    | "professionals"
    | "audit"
    | "access_profiles";
  href: string;
  label: string;
  permission: PermissionKey;
  section: "main" | "administration";
  requiresAdministrator?: boolean;
};

export const navigationItems: readonly NavigationItem[] = [
  { id: "dashboard", href: "/painel", label: "Visão geral", permission: "dashboard.view", section: "main" },
  { id: "orders", href: "/ordens", label: "Ordens de serviço", permission: "orders.view", section: "main" },
  { id: "units", href: "/unidades", label: "Unidades", permission: "units.view", section: "main" },
  { id: "logistics", href: "/cadastros/logistics", label: "Logística", permission: "logistics.view", section: "main" },
  { id: "routes", href: "/cadastros/routes", label: "Rotas", permission: "routes.view", section: "main" },
  { id: "vehicles", href: "/cadastros/vehicles", label: "Veículos", permission: "vehicles.view", section: "main" },
  { id: "drivers", href: "/cadastros/drivers", label: "Motoristas", permission: "drivers.view", section: "main" },
  {
    id: "professionals",
    href: "/usuarios",
    label: "Usuários e vínculos",
    permission: "professionals.view",
    section: "administration",
    requiresAdministrator: true,
  },
  {
    id: "audit",
    href: "/auditoria",
    label: "Auditoria",
    permission: "audit.view",
    section: "administration",
    requiresAdministrator: true,
  },
  {
    id: "access_profiles",
    href: "/perfis",
    label: "Perfis e Permissões",
    permission: "professionals.manage",
    section: "administration",
    requiresAdministrator: true,
  },
] as const;

export function visibleNavigationItems(
  permissions: ReadonlySet<PermissionKey>,
  administrator: boolean,
) {
  return navigationItems.filter(
    (item) =>
      permissions.has(item.permission) &&
      (!item.requiresAdministrator || administrator),
  );
}
