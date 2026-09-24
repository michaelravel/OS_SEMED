import { configured } from "@/lib/supabase";
import {
  logServerEvent,
  normalizeRequestId,
} from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId =
    normalizeRequestId(request.headers.get("x-request-id")) ??
    crypto.randomUUID();
  const configurationReady = configured();
  const status = configurationReady ? "ok" : "degraded";

  if (!configurationReady) {
    logServerEvent("warn", "health_check_degraded", {
      requestId,
      route: "/api/health",
      method: "GET",
      status,
    });
  }

  return Response.json(
    {
      status,
      checks: {
        application: "ok",
        configuration: configurationReady ? "ok" : "error",
      },
      requestId,
    },
    {
      status: configurationReady ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
      },
    },
  );
}
