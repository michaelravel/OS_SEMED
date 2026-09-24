export const actionErrorCodes = [
  "validation",
  "conflict",
  "forbidden",
  "not_found",
  "business_rule",
  "unexpected",
] as const;

export type ActionErrorCode = (typeof actionErrorCodes)[number];

type DatabaseErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function classifyOrderRpcError(error: unknown): ActionErrorCode {
  if (!error || typeof error !== "object") return "unexpected";
  const candidate = error as DatabaseErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message =
    typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";

  if (
    message.includes("conflito de versão") ||
    message.includes("alterada por outro usuário")
  )
    return "conflict";
  if (
    code === "42501" ||
    message.includes("acesso negado") ||
    message.includes("não autorizado") ||
    message.includes("permission denied") ||
    message.includes("row-level security")
  )
    return "forbidden";
  if (message.includes("não encontrada")) return "not_found";
  if (
    code === "23503" ||
    code === "23505" ||
    code === "23514" ||
    message.includes("não permitid") ||
    message.includes("obrigatóri") ||
    message.includes("inválid") ||
    message.includes("registre o atendimento") ||
    message.includes("não conciliada")
  )
    return "business_rule";
  return "unexpected";
}

export const actionErrorMessages: Record<ActionErrorCode, string> = {
  validation: "Revise os campos informados e tente novamente.",
  conflict:
    "A ordem foi alterada por outra pessoa. Atualize a página antes de tentar novamente.",
  forbidden: "Seu usuário não possui permissão para executar esta operação.",
  not_found: "A ordem solicitada não foi encontrada ou não está mais disponível.",
  business_rule:
    "A operação não pode ser concluída no estado atual da ordem. Atualize a página e revise os dados.",
  unexpected: "Não foi possível concluir a operação. Tente novamente.",
};

export function isActionErrorCode(value: string): value is ActionErrorCode {
  return actionErrorCodes.includes(value as ActionErrorCode);
}
