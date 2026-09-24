import "server-only";
import { redirect } from "next/navigation";
import { logServerEvent } from "@/lib/observability";
import { currentRequestId } from "@/lib/request-context";

export function formText(form: FormData, key: string) {
  return String(form.get(key) ?? "");
}

export async function actionFailed(path: string): Promise<never> {
  logServerEvent("warn", "server_action_rejected", {
    requestId: await currentRequestId(),
    route: path,
    operation: "server_action",
  });
  redirect(`${path}${path.includes("?") ? "&" : "?"}erro=1`);
}

export function requireAdministrator(admin: boolean): asserts admin {
  if (!admin) throw new Error("Acesso negado");
}
