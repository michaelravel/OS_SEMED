"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { configured, supabase } from "@/lib/supabase";
import { fieldLimits } from "@/lib/application-config";
import { actionFailed } from "./shared";
import { allowedGoogleDomains } from "@/lib/professional-identity";

async function applicationOrigin() {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredOrigin) return new URL(configuredOrigin).origin;
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin) return new URL(origin).origin;
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  if (!host) throw new Error("Origem da aplicação não configurada");
  return new URL(`${protocol}://${host}`).origin;
}

export async function loginWithGoogle() {
  if (!configured()) redirect("/configuracao");
  if (allowedGoogleDomains().length === 0)
    redirect("/login?oauth=configuracao");
  const db = await supabase();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await applicationOrigin()}/auth/callback`,
      scopes: "openid email profile",
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/login?oauth=indisponivel");
  redirect(data.url);
}

export async function login(form: FormData) {
  if (!configured()) redirect("/configuracao");
  const input = z
    .object({
      email: z.email().max(fieldLimits.email),
      password: z.string().min(1).max(fieldLimits.password),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed("/login");
  const db = await supabase();
  const { error } = await db.auth.signInWithPassword(input.data);
  if (error) return actionFailed("/login");
  redirect("/painel");
}

export async function logout() {
  if (!configured()) redirect("/configuracao");
  const db = await supabase();
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) redirect("/login?logout=erro");
  redirect("/login");
}
