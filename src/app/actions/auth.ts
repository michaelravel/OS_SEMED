"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { configured, supabase } from "@/lib/supabase";
import { fieldLimits } from "@/lib/application-config";
import { actionFailed } from "./shared";

export async function login(form: FormData) {
  if (!configured()) redirect("/configuracao");
  const input = z
    .object({
      email: z.email().max(fieldLimits.email),
      password: z.string().min(1).max(fieldLimits.password),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) actionFailed("/login");
  const db = await supabase();
  const { error } = await db.auth.signInWithPassword(input.data);
  if (error) actionFailed("/login");
  redirect("/painel");
}

export async function logout() {
  if (!configured()) redirect("/configuracao");
  const db = await supabase();
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) redirect("/login?logout=erro");
  redirect("/login");
}
