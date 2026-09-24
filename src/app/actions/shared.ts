import "server-only";
import { redirect } from "next/navigation";
import { logServerEvent } from "@/lib/observability";
import { currentRequestId } from "@/lib/request-context";
import {
  classifyOrderRpcError,
  type ActionErrorCode,
} from "@/lib/action-result";

export function formText(form: FormData, key: string) {
  return String(form.get(key) ?? "");
}

export async function actionFailed(
  path: string,
  code: ActionErrorCode = "unexpected",
  operation = "server_action",
): Promise<never> {
  logServerEvent("warn", "server_action_rejected", {
    requestId: await currentRequestId(),
    route: path,
    operation,
    status: code,
  });
  redirect(
    `${path}${path.includes("?") ? "&" : "?"}erro=${encodeURIComponent(code)}`,
  );
}

export function orderActionFailed(
  path: string,
  error: unknown,
  operation: string,
): Promise<never> {
  return actionFailed(path, classifyOrderRpcError(error), operation);
}

export function requireAdministrator(admin: boolean): asserts admin {
  if (!admin) throw new Error("Acesso negado");
}
