import { z } from "zod";
import { fieldLimits } from "./application-config";
import {
  canonicalOrderStatusNames,
  compatibleOrderStatuses,
  legacyOrderStatusNames,
  orderCompletionSchema,
  orderJustificationSchema,
  priorities,
  terminalOrderStatuses,
  workflowLimits,
  type CompatibleOrderStatus,
  type OrderPriority,
  type OrderResumeStatus,
  type OrderWaitReason,
} from "./order-workflow";

export * from "./order-workflow";

// Compatibilidade temporária com telas e RPCs anteriores à migration do novo
// fluxo. Novos recursos devem consumir canonicalOrderStatusNames.
export const orderStatusNames = {
  ...canonicalOrderStatusNames,
  analyzing: legacyOrderStatusNames.analyzing,
  executing: legacyOrderStatusNames.executing,
  waitingMaterial: legacyOrderStatusNames.waitingMaterial,
  waitingLogistics: legacyOrderStatusNames.waitingLogistics,
} as const;
export const pendingStatus = orderStatusNames.pendingReview;
export const statuses = [
  orderStatusNames.open,
  orderStatusNames.analyzing,
  orderStatusNames.executing,
  orderStatusNames.waitingMaterial,
  orderStatusNames.waitingLogistics,
  orderStatusNames.completed,
  orderStatusNames.canceled,
] as const;
export const orderStatuses = [pendingStatus, ...statuses] as const;
export type OrderStatus = CompatibleOrderStatus;
export const progressStatuses = [
  orderStatusNames.open,
  orderStatusNames.analyzing,
  orderStatusNames.executing,
  orderStatusNames.waitingMaterial,
  orderStatusNames.waitingLogistics,
] as const;
export const terminalStatuses = terminalOrderStatuses;
const workflowId = z.uuid();
export const advanceOrderSchema = z.object({
  id: workflowId,
  status: z.enum(progressStatuses),
  reason: z.string().trim().max(workflowLimits.justificationMax),
});
export const completeOrderSchema = orderCompletionSchema;
export const justifyOrderSchema = orderJustificationSchema;
export const roleNames = {
  administrator: "admin",
  manager: "gestor",
  requester: "solicitante",
  responsible: "responsavel",
} as const;
export const roles = [
  roleNames.administrator,
  roleNames.manager,
  roleNames.requester,
  roleNames.responsible,
] as const;
export type Role = (typeof roles)[number];
export type Membership = {
  id: string;
  user_id: string | null;
  professional_id: string;
  access_profile_id: string;
  unit_id: string | null;
  role: Role;
  active: boolean;
};
export type Unit = {
  id: string;
  name: string;
  type: string;
  address: string;
  coordinates: string;
  active: boolean;
};
export const catalogKinds = [
  "logistics",
  "routes",
  "vehicles",
  "drivers",
] as const;
export type CatalogKind = (typeof catalogKinds)[number];
export function isCatalogKind(value: string): value is CatalogKind {
  return catalogKinds.includes(value as CatalogKind);
}
export type CatalogDataKey =
  | "area"
  | "nature"
  | "type"
  | "description"
  | "detail"
  | "options"
  | "reminder"
  | "routeId"
  | "number"
  | "link"
  | "plate"
  | "model"
  | "seats"
  | "driverId";
export type CatalogData = Partial<Record<CatalogDataKey, string>>;
export type Catalog = {
  id: string;
  legacy_id: string;
  kind: CatalogKind;
  name: string;
  data: CatalogData;
  active: boolean;
};
export type OrderDetails = {
  observation?: string;
  occurred_at?: string;
  has_material?: "Não informado" | "Sim" | "Não";
  police_report?: string;
  [legacyField: string]: string | undefined;
};
export function isOrderStatus(value: string): value is OrderStatus {
  return compatibleOrderStatuses.includes(value as OrderStatus);
}
export type Order = {
  id: string;
  protocol: number;
  protocol_year: number | null;
  protocol_code: string | null;
  legacy_id: string | null;
  title: string;
  status: OrderStatus;
  priority: OrderPriority;
  status_reason: string;
  resolution: string | null;
  unit_id: string | null;
  destination_unit_id: string | null;
  opened_by: string | null;
  responsible_id: string | null;
  category_id: string | null;
  category_kind: "logistics";
  driver_id: string | null;
  driver_kind: "drivers";
  vehicle_id: string | null;
  vehicle_kind: "vehicles";
  route_id: string | null;
  route_kind: "routes";
  requester_membership_id: string | null;
  responsible_membership_id: string | null;
  import_source: string | null;
  import_source_id: string | null;
  details: OrderDetails;
  created_at: string;
  opened_at: string | null;
  triaged_at: string | null;
  forwarded_at: string | null;
  assigned_at: string | null;
  service_started_at: string | null;
  waiting_since: string | null;
  waiting_reason: OrderWaitReason | null;
  waiting_details: string | null;
  resume_status: OrderResumeStatus | null;
  priority_reason: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reopened_at: string | null;
  version: number;
  active: boolean;
};
export const orderSchema = z.object({
  title: z.string().trim().min(3).max(fieldLimits.title),
  unit_id: z.uuid(),
  category_id: z.uuid(),
  priority: z.enum(priorities),
  observation: z.string().trim().max(fieldLimits.observation),
  occurred_at: z.string().max(30),
  has_material: z.enum(["Não informado", "Sim", "Não"]),
  police_report: z.string().trim().max(fieldLimits.policeReport),
  driver: z.union([z.literal(""), z.uuid()]),
  vehicle: z.union([z.literal(""), z.uuid()]),
  route: z.union([z.literal(""), z.uuid()]),
});
export function isAdmin(memberships: Membership[]) {
  return memberships.some(
    (m) => m.active && m.role === "admin" && m.unit_id === null,
  );
}
export function canOpen(memberships: Membership[]) {
  return memberships.some(
    (m) => m.active && ["admin", "solicitante"].includes(m.role),
  );
}
export const catalogFields = {
  logistics: {
    label: "Classificações logísticas",
    fields: [
      ["area", "Área"],
      ["nature", "Natureza"],
      ["type", "Tipo"],
      ["description", "Descrição"],
      ["detail", "Detalhamento"],
      ["options", "Opções"],
      ["reminder", "Lembrete"],
    ],
  },
  routes: {
    label: "Rotas",
    fields: [
      ["routeId", "Código"],
      ["number", "Número"],
      ["link", "Link do mapa"],
    ],
  },
  vehicles: {
    label: "Veículos",
    fields: [
      ["plate", "Placa"],
      ["model", "Modelo / tipo"],
      ["seats", "Passageiros"],
    ],
  },
  drivers: { label: "Motoristas", fields: [["driverId", "Identificador"]] },
} satisfies Record<
  CatalogKind,
  { label: string; fields: [CatalogDataKey, string][] }
>;
