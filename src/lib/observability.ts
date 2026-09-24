export type LogLevel = "info" | "warn" | "error";

export type LogContext = {
  requestId?: string;
  route?: string;
  method?: string;
  operation?: string;
  status?: string;
  durationMs?: number;
  error?: unknown;
};

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeCodePattern = /^[a-z0-9_.:-]{1,80}$/i;

export function normalizeRequestId(value: string | null | undefined) {
  return value && requestIdPattern.test(value) ? value.toLowerCase() : null;
}

function safeErrorMetadata(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    digest?: unknown;
  };
  const name =
    typeof candidate.name === "string" &&
    safeCodePattern.test(candidate.name)
      ? candidate.name
      : "UnknownError";
  const code =
    typeof candidate.code === "string" &&
    safeCodePattern.test(candidate.code)
      ? candidate.code
      : undefined;
  const digest =
    typeof candidate.digest === "string" &&
    safeCodePattern.test(candidate.digest)
      ? candidate.digest
      : undefined;
  return { name, ...(code ? { code } : {}), ...(digest ? { digest } : {}) };
}

export function structuredLogRecord(
  level: LogLevel,
  event: string,
  context: LogContext = {},
) {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.route ? { route: context.route.split("?")[0] } : {}),
    ...(context.method ? { method: context.method } : {}),
    ...(context.operation ? { operation: context.operation } : {}),
    ...(context.status ? { status: context.status } : {}),
    ...(typeof context.durationMs === "number"
      ? { durationMs: Math.max(0, Math.round(context.durationMs)) }
      : {}),
    ...(context.error
      ? { error: safeErrorMetadata(context.error) }
      : {}),
  };
}

export function logServerEvent(
  level: LogLevel,
  event: string,
  context: LogContext = {},
) {
  const serialized = JSON.stringify(structuredLogRecord(level, event, context));
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.info(serialized);
}
