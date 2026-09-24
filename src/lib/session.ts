import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { configured, supabase } from "./supabase";
import { isAdmin, type Membership } from "./domain";
import { ServerOperationError } from "./errors";
export const session = cache(async () => {
  if (!configured()) redirect("/configuracao");
  const db = await supabase();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const { data, error: membershipError } = await db
    .from("os_memberships")
    .select("id,user_id,unit_id,role,active")
    .eq("user_id", user.id)
    .eq("active", true);
  if (membershipError)
    throw new ServerOperationError(
      "MEMBERSHIP_QUERY_FAILED",
      "Não foi possível verificar os vínculos.",
    );
  const memberships = (data ?? []) as Membership[];
  if (!memberships.length) redirect("/sem-acesso");
  return { db, user, memberships, admin: isAdmin(memberships) };
});
