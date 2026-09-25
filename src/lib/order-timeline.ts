export const orderTimelineEventLabels: Readonly<Record<string, string>> = {
  order_opened: "Abertura",
  order_reconciled: "Conciliação",
  triage_started: "Início da triagem",
  category_changed: "Alteração de categoria",
  priority_changed: "Alteração de prioridade",
  order_forwarded: "Encaminhamento",
  order_assigned: "Atribuição",
  order_reassigned: "Reatribuição",
  service_started: "Início do atendimento",
  service_entry_added: "Registro de atendimento",
  information_wait_started: "Solicitação de informação",
  service_resumed: "Retomada",
  order_completed: "Conclusão",
  order_canceled: "Cancelamento",
  order_reopened: "Reabertura",
  order_edited: "Edição controlada",
  attachment_added: "Anexo adicionado",
  service_attachment_added: "Anexo do atendimento adicionado",
  workflow_backfill: "Adequação ao novo fluxo",
};

export function orderTimelineEventLabel(
  eventType: string | null,
  fromStatus: string | null,
) {
  if (eventType) return orderTimelineEventLabels[eventType] ?? "Evento da ordem";
  return fromStatus ? "Alteração de situação" : "Abertura";
}

export function orderTimelineTransition(
  fromStatus: string | null,
  toStatus: string,
) {
  if (!fromStatus || fromStatus === toStatus) return null;
  return `${fromStatus} → ${toStatus}`;
}
