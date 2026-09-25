import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  institutionalEmailDomain,
  isAllowedGoogleEmail,
} from "@/lib/professional-identity";
import { logServerEvent } from "@/lib/observability";
import { resolveFirstAuthorizedRoute } from "@/lib/authorization";

const safeResults: Record<string, string> = {
  not_registered: "nao-cadastrado",
  inactive: "inativo",
  identity_conflict: "conflito-identidade",
  unverified_provider: "provedor-invalido",
};

function loginRedirect(request: Request, reason: string) {
  return NextResponse.redirect(new URL(`/login?oauth=${reason}`, request.url), 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return loginRedirect(request, "callback-invalido");

  const db = await supabase();
  const exchanged = await db.auth.exchangeCodeForSession(code);
  if (exchanged.error) return loginRedirect(request, "callback-invalido");

  const { data, error } = await db.auth.getUser();
  const user = data.user;
  const googleIdentity = user?.identities?.some(
    (identity) => identity.provider === "google",
  );
  const email = user?.email ?? "";
  if (error || !user || !user.email_confirmed_at || !googleIdentity) {
    await db.auth.signOut({ scope: "local" });
    return loginRedirect(request, "provedor-invalido");
  }

  if (!isAllowedGoogleEmail(email)) {
    await db.rpc("os_record_identity_denial", {
      denial_type: "domain_rejected",
      denied_domain: institutionalEmailDomain(email),
    });
    await db.auth.signOut({ scope: "local" });
    return loginRedirect(request, "dominio");
  }

  const claim = await db.rpc("os_claim_professional_identity");
  if (claim.error) {
    logServerEvent("error", "google_identity_claim_failed", {
      route: "/auth/callback",
      operation: "os_claim_professional_identity",
      status: claim.error.code,
    });
    await db.auth.signOut({ scope: "local" });
    return loginRedirect(request, "indisponivel");
  }
  const result = claim.data?.[0];
  if (!result || !["linked", "relinked", "already_linked"].includes(result.result)) {
    await db.auth.signOut({ scope: "local" });
    return loginRedirect(
      request,
      result ? (safeResults[result.result] ?? "indisponivel") : "indisponivel",
    );
  }
  if (result.active_memberships < 1)
    return NextResponse.redirect(new URL("/sem-acesso", request.url), 303);
  const destination = await resolveFirstAuthorizedRoute(db);
  return NextResponse.redirect(new URL(destination, request.url), 303);
}
