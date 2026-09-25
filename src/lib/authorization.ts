import "server-only";
import { redirect } from "next/navigation";
import { session } from "./session";
import { ServerOperationError } from "./errors";
import type { supabase } from "./supabase";
import {
  isPermissionKey,
  type PermissionKey,
} from "./authorization-core";
import { firstAuthorizedRoute } from "./navigation";

export type AuthorizationClient = Awaited<ReturnType<typeof supabase>>;

export class PermissionDeniedError extends ServerOperationError {
  constructor() {
    super("PERMISSION_DENIED", "Seu usuário não possui permissão para esta operação.");
    this.name = "PermissionDeniedError";
  }
}

async function authorizationClient(client?: AuthorizationClient) {
  return client ?? (await session()).db;
}

// Não usa cache de processo, JWT ou duração fixa. Cada chamada consulta o
// PostgreSQL com a sessão atual; remoções passam a valer na próxima operação.
export async function getUserPermissions(client?: AuthorizationClient) {
  const db = await authorizationClient(client);
  const { data, error } = await db.rpc("os_current_permissions");
  if (error)
    throw new ServerOperationError(
      "PERMISSION_QUERY_FAILED",
      "Não foi possível verificar as permissões.",
    );
  return new Set(
    (data ?? [])
      .map(({ permission_key }) => permission_key)
      .filter(isPermissionKey),
  );
}

export async function hasPermission(
  permission: PermissionKey,
  client?: AuthorizationClient,
) {
  const db = await authorizationClient(client);
  const { data, error } = await db.rpc("os_has_permission", {
    permission_key: permission,
  });
  if (error)
    throw new ServerOperationError(
      "PERMISSION_QUERY_FAILED",
      "Não foi possível verificar a permissão.",
    );
  return data === true;
}

export async function requirePermission(
  permission: PermissionKey,
  client?: AuthorizationClient,
) {
  if (!(await hasPermission(permission, client)))
    throw new PermissionDeniedError();
}

export async function requirePagePermission(
  permission: PermissionKey,
  client?: AuthorizationClient,
) {
  if (!(await hasPermission(permission, client))) redirect("/sem-acesso");
}

export async function resolveFirstAuthorizedRoute(
  client?: AuthorizationClient,
  knownAdministrator?: boolean,
) {
  const db = await authorizationClient(client);
  const permissions = await getUserPermissions(db);
  let administrator = knownAdministrator;
  if (administrator === undefined) {
    const { data, error } = await db
      .from("os_memberships")
      .select("role,unit_id,active")
      .eq("active", true);
    if (error)
      throw new ServerOperationError(
        "MEMBERSHIP_QUERY_FAILED",
        "Não foi possível verificar os vínculos.",
      );
    administrator = (data ?? []).some(
      (membership) =>
        membership.active &&
        membership.role === "admin" &&
        membership.unit_id === null,
    );
  }
  return firstAuthorizedRoute(permissions, administrator);
}
