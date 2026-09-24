import "server-only";
import { redirect } from "next/navigation";

export function formText(form: FormData, key: string) {
  return String(form.get(key) ?? "");
}

export function actionFailed(path: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}erro=1`);
}

export function requireAdministrator(admin: boolean): asserts admin {
  if (!admin) throw new Error("Acesso negado");
}
