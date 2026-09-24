import { z } from "zod";
export const statuses = [
  "Aberta",
  "Em análise",
  "Em execução",
  "Aguardando material",
  "Aguardando deslocamento/logística",
  "Concluída",
  "Cancelada",
] as const;
export type OrderStatus = (typeof statuses)[number];
export const progressStatuses = [
  "Aberta",
  "Em análise",
  "Em execução",
  "Aguardando material",
  "Aguardando deslocamento/logística",
] as const;
export const priorities = ["Baixa", "Normal", "Alta", "Urgente"] as const;
export type OrderPriority = (typeof priorities)[number];
export const terminalStatuses = ["Concluída", "Cancelada"] as const;
export const workflowLimits = {
  justificationMin: 3,
  justificationMax: 2000,
  solutionMin: 3,
  solutionMax: 5000,
} as const;
const workflowId = z.uuid();
export const advanceOrderSchema = z.object({
  id: workflowId,
  status: z.enum(progressStatuses),
  reason: z.string().trim().max(workflowLimits.justificationMax),
});
export const completeOrderSchema = z.object({
  id: workflowId,
  solution: z
    .string()
    .trim()
    .min(workflowLimits.solutionMin)
    .max(workflowLimits.solutionMax),
});
export const justifyOrderSchema = z.object({
  id: workflowId,
  justification: z
    .string()
    .trim()
    .min(workflowLimits.justificationMin)
    .max(workflowLimits.justificationMax),
});
export const roles = ["admin", "gestor", "solicitante", "responsavel"] as const;
export type Role = (typeof roles)[number];
export type Membership = {
  id: string;
  user_id: string;
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
export type Catalog = {
  id: string;
  legacy_id: string;
  kind: string;
  name: string;
  data: Record<string, string>;
  active: boolean;
};
export type Order = {
  id: string;
  protocol: number;
  legacy_id: string | null;
  title: string;
  status: string;
  priority: OrderPriority;
  status_reason: string;
  resolution: string | null;
  unit_id: string | null;
  opened_by: string | null;
  responsible_id: string | null;
  category_id: string | null;
  details: Record<string, string>;
  created_at: string;
  opened_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reopened_at: string | null;
  active: boolean;
};
export const orderSchema = z.object({
  title: z.string().trim().min(3).max(500),
  unit_id: z.uuid(),
  category_id: z.uuid(),
  priority: z.enum(priorities),
  observation: z.string().trim().max(5000),
  occurred_at: z.string().max(30),
  has_material: z.enum(["Não informado", "Sim", "Não"]),
  police_report: z.string().trim().max(200),
  driver: z.string().max(300),
  vehicle: z.string().max(300),
  route: z.string().max(300),
});
export const allowedMimes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
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
export const catalogFields: Record<
  string,
  { label: string; fields: [string, string][] }
> = {
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
};
