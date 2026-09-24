import type { Instrumentation } from "next";
import {
  logServerEvent,
  normalizeRequestId,
} from "@/lib/observability";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const header = request.headers["x-request-id"];
  const requestId = normalizeRequestId(
    Array.isArray(header) ? header[0] : header,
  );
  logServerEvent("error", "server_request_failed", {
    requestId: requestId ?? undefined,
    route: request.path,
    method: request.method,
    operation: context.routeType,
    error,
  });
};
