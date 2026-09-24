import { z } from "zod";

export const workflowLimits = {
  justificationMin: 3,
  justificationMax: 2_000,
  solutionMin: 3,
  solutionMax: 5_000,
} as const;

export const canonicalOrderStatusNames = {
  pendingReview: "A conferir",
  open: "Aberta",
  triage: "Em triagem",
  forwarded: "Encaminhada",
  assigned: "Atribuída",
  inService: "Em atendimento",
  waitingInformation: "Aguardando informação",
  completed: "Concluída",
  canceled: "Cancelada",
} as const;

export const canonicalOrderStatuses = [
  canonicalOrderStatusNames.pendingReview,
  canonicalOrderStatusNames.open,
  canonicalOrderStatusNames.triage,
  canonicalOrderStatusNames.forwarded,
  canonicalOrderStatusNames.assigned,
  canonicalOrderStatusNames.inService,
  canonicalOrderStatusNames.waitingInformation,
  canonicalOrderStatusNames.completed,
  canonicalOrderStatusNames.canceled,
] as const;
export type CanonicalOrderStatus = (typeof canonicalOrderStatuses)[number];

export const legacyOrderStatusNames = {
  analyzing: "Em análise",
  executing: "Em execução",
  waitingMaterial: "Aguardando material",
  waitingLogistics: "Aguardando deslocamento/logística",
} as const;
export const legacyOnlyOrderStatuses = [
  legacyOrderStatusNames.analyzing,
  legacyOrderStatusNames.executing,
  legacyOrderStatusNames.waitingMaterial,
  legacyOrderStatusNames.waitingLogistics,
] as const;
export type LegacyOrderStatus = (typeof legacyOnlyOrderStatuses)[number];

export const compatibleOrderStatuses = [
  ...canonicalOrderStatuses,
  ...legacyOnlyOrderStatuses,
] as const;
export type CompatibleOrderStatus = (typeof compatibleOrderStatuses)[number];

export const orderPriorityNames = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
} as const;
export const priorities = [
  orderPriorityNames.low,
  orderPriorityNames.normal,
  orderPriorityNames.high,
  orderPriorityNames.urgent,
] as const;
export type OrderPriority = (typeof priorities)[number];

export const orderWaitReasonNames = {
  material: "material",
  logistics: "logística",
  requester: "solicitante",
  unit: "unidade",
  external: "terceiro",
  other: "outro",
} as const;
export const orderWaitReasons = [
  orderWaitReasonNames.material,
  orderWaitReasonNames.logistics,
  orderWaitReasonNames.requester,
  orderWaitReasonNames.unit,
  orderWaitReasonNames.external,
  orderWaitReasonNames.other,
] as const;
export type OrderWaitReason = (typeof orderWaitReasons)[number];

export const orderOperationNames = {
  open: "open",
  reconcile: "reconcile",
  startTriage: "start_triage",
  forward: "forward",
  assign: "assign",
  returnToTriage: "return_to_triage",
  returnToForwarding: "return_to_forwarding",
  startService: "start_service",
  waitForInformation: "wait_for_information",
  resume: "resume",
  complete: "complete",
  cancel: "cancel",
  reopen: "reopen",
} as const;
export const orderOperations = [
  orderOperationNames.open,
  orderOperationNames.reconcile,
  orderOperationNames.startTriage,
  orderOperationNames.forward,
  orderOperationNames.assign,
  orderOperationNames.returnToTriage,
  orderOperationNames.returnToForwarding,
  orderOperationNames.startService,
  orderOperationNames.waitForInformation,
  orderOperationNames.resume,
  orderOperationNames.complete,
  orderOperationNames.cancel,
  orderOperationNames.reopen,
] as const;
export type OrderOperation = (typeof orderOperations)[number];

export const terminalOrderStatuses = [
  canonicalOrderStatusNames.completed,
  canonicalOrderStatusNames.canceled,
] as const;
export type TerminalOrderStatus = (typeof terminalOrderStatuses)[number];

export type OrderTransition = {
  from: CanonicalOrderStatus;
  to: CanonicalOrderStatus;
  operation: OrderOperation;
};

export const allowedOrderTransitions = [
  {
    from: canonicalOrderStatusNames.pendingReview,
    to: canonicalOrderStatusNames.triage,
    operation: orderOperationNames.reconcile,
  },
  {
    from: canonicalOrderStatusNames.pendingReview,
    to: canonicalOrderStatusNames.canceled,
    operation: orderOperationNames.cancel,
  },
  {
    from: canonicalOrderStatusNames.open,
    to: canonicalOrderStatusNames.triage,
    operation: orderOperationNames.startTriage,
  },
  {
    from: canonicalOrderStatusNames.open,
    to: canonicalOrderStatusNames.canceled,
    operation: orderOperationNames.cancel,
  },
  {
    from: canonicalOrderStatusNames.triage,
    to: canonicalOrderStatusNames.forwarded,
    operation: orderOperationNames.forward,
  },
  {
    from: canonicalOrderStatusNames.triage,
    to: canonicalOrderStatusNames.waitingInformation,
    operation: orderOperationNames.waitForInformation,
  },
  {
    from: canonicalOrderStatusNames.triage,
    to: canonicalOrderStatusNames.canceled,
    operation: orderOperationNames.cancel,
  },
  {
    from: canonicalOrderStatusNames.forwarded,
    to: canonicalOrderStatusNames.assigned,
    operation: orderOperationNames.assign,
  },
  {
    from: canonicalOrderStatusNames.forwarded,
    to: canonicalOrderStatusNames.triage,
    operation: orderOperationNames.returnToTriage,
  },
  {
    from: canonicalOrderStatusNames.forwarded,
    to: canonicalOrderStatusNames.waitingInformation,
    operation: orderOperationNames.waitForInformation,
  },
  {
    from: canonicalOrderStatusNames.forwarded,
    to: canonicalOrderStatusNames.canceled,
    operation: orderOperationNames.cancel,
  },
  {
    from: canonicalOrderStatusNames.assigned,
    to: canonicalOrderStatusNames.inService,
    operation: orderOperationNames.startService,
  },
  {
    from: canonicalOrderStatusNames.assigned,
    to: canonicalOrderStatusNames.forwarded,
    operation: orderOperationNames.returnToForwarding,
  },
  {
    from: canonicalOrderStatusNames.assigned,
    to: canonicalOrderStatusNames.waitingInformation,
    operation: orderOperationNames.waitForInformation,
  },
  {
    from: canonicalOrderStatusNames.assigned,
    to: canonicalOrderStatusNames.canceled,
    operation: orderOperationNames.cancel,
  },
  {
    from: canonicalOrderStatusNames.inService,
    to: canonicalOrderStatusNames.waitingInformation,
    operation: orderOperationNames.waitForInformation,
  },
  {
    from: canonicalOrderStatusNames.inService,
    to: canonicalOrderStatusNames.completed,
    operation: orderOperationNames.complete,
  },
  {
    from: canonicalOrderStatusNames.inService,
    to: canonicalOrderStatusNames.canceled,
    operation: orderOperationNames.cancel,
  },
  ...[
    canonicalOrderStatusNames.triage,
    canonicalOrderStatusNames.forwarded,
    canonicalOrderStatusNames.assigned,
    canonicalOrderStatusNames.inService,
  ].map(
    (to): OrderTransition => ({
      from: canonicalOrderStatusNames.waitingInformation,
      to,
      operation: orderOperationNames.resume,
    }),
  ),
  {
    from: canonicalOrderStatusNames.waitingInformation,
    to: canonicalOrderStatusNames.canceled,
    operation: orderOperationNames.cancel,
  },
  {
    from: canonicalOrderStatusNames.completed,
    to: canonicalOrderStatusNames.triage,
    operation: orderOperationNames.reopen,
  },
  {
    from: canonicalOrderStatusNames.canceled,
    to: canonicalOrderStatusNames.triage,
    operation: orderOperationNames.reopen,
  },
] as const satisfies readonly OrderTransition[];

export function isCanonicalOrderStatus(
  value: string,
): value is CanonicalOrderStatus {
  return canonicalOrderStatuses.includes(value as CanonicalOrderStatus);
}

export function isTerminalOrderStatus(
  value: CanonicalOrderStatus,
): value is TerminalOrderStatus {
  return terminalOrderStatuses.includes(value as TerminalOrderStatus);
}

export function isAllowedOrderTransition(
  from: CanonicalOrderStatus,
  to: CanonicalOrderStatus,
  operation?: OrderOperation,
) {
  return allowedOrderTransitions.some(
    (transition) =>
      transition.from === from &&
      transition.to === to &&
      (!operation || transition.operation === operation),
  );
}

export function orderTransitionsFrom(status: CanonicalOrderStatus) {
  return allowedOrderTransitions.filter(
    (transition) => transition.from === status,
  );
}

export const legacyOrderStatusMapping = {
  [legacyOrderStatusNames.analyzing]: {
    status: canonicalOrderStatusNames.triage,
  },
  [legacyOrderStatusNames.executing]: {
    status: canonicalOrderStatusNames.inService,
  },
  [legacyOrderStatusNames.waitingMaterial]: {
    status: canonicalOrderStatusNames.waitingInformation,
    waitingReason: orderWaitReasonNames.material,
  },
  [legacyOrderStatusNames.waitingLogistics]: {
    status: canonicalOrderStatusNames.waitingInformation,
    waitingReason: orderWaitReasonNames.logistics,
  },
} as const satisfies Record<
  LegacyOrderStatus,
  { status: CanonicalOrderStatus; waitingReason?: OrderWaitReason }
>;

export function normalizeOrderStatus(value: string): {
  status: CanonicalOrderStatus;
  waitingReason?: OrderWaitReason;
} | null {
  if (isCanonicalOrderStatus(value)) return { status: value };
  if (Object.hasOwn(legacyOrderStatusMapping, value))
    return legacyOrderStatusMapping[value as LegacyOrderStatus];
  return null;
}

export const orderStatusSchema = z.enum(canonicalOrderStatuses);
export const compatibleOrderStatusSchema = z.enum(compatibleOrderStatuses);
export const orderOperationSchema = z.enum(orderOperations);
export const orderWaitReasonSchema = z.enum(orderWaitReasons);
export const orderPrioritySchema = z.enum(priorities);

const workflowIdSchema = z.uuid();
export const orderTransitionRequestSchema = z
  .object({
    id: workflowIdSchema,
    from: orderStatusSchema,
    to: orderStatusSchema,
    operation: orderOperationSchema,
    reason: z.string().trim().max(workflowLimits.justificationMax),
  })
  .superRefine((transition, context) => {
    if (
      !isAllowedOrderTransition(
        transition.from,
        transition.to,
        transition.operation,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Transição de ordem de serviço inválida",
      });
  });

export const orderWaitingSchema = z.object({
  id: workflowIdSchema,
  waitingReason: orderWaitReasonSchema,
  justification: z
    .string()
    .trim()
    .min(workflowLimits.justificationMin)
    .max(workflowLimits.justificationMax),
  resumeStatus: z.enum([
    canonicalOrderStatusNames.triage,
    canonicalOrderStatusNames.forwarded,
    canonicalOrderStatusNames.assigned,
    canonicalOrderStatusNames.inService,
  ]),
});

export const orderCompletionSchema = z.object({
  id: workflowIdSchema,
  solution: z
    .string()
    .trim()
    .min(workflowLimits.solutionMin)
    .max(workflowLimits.solutionMax),
});

export const orderJustificationSchema = z.object({
  id: workflowIdSchema,
  justification: z
    .string()
    .trim()
    .min(workflowLimits.justificationMin)
    .max(workflowLimits.justificationMax),
});
