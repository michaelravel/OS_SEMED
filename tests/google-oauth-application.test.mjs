import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const [authAction, callback, loginPage, usersPage] = await Promise.all([
  fs.readFile(new URL("../src/app/actions/auth.ts", import.meta.url), "utf8"),
  fs.readFile(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8"),
  fs.readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8"),
  fs.readFile(new URL("../src/app/(app)/usuarios/page.tsx", import.meta.url), "utf8"),
]);

test("login inicia Google OAuth pelo Supabase com callback PKCE server-side", () => {
  assert.match(authAction, /signInWithOAuth/);
  assert.match(authAction, /provider:\s*"google"/);
  assert.match(authAction, /\/auth\/callback/);
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(callback, /auth\.getUser\(\)/);
});

test("callback valida Google, domínio e associação transacional antes do painel", () => {
  assert.match(callback, /identity\.provider === "google"/);
  assert.match(callback, /isAllowedGoogleEmail/);
  assert.match(callback, /os_claim_professional_identity/);
  assert.match(callback, /signOut/);
});

test("interface preserva senha legada e remove UUID do fluxo administrativo novo", () => {
  assert.match(loginPage, /Entrar com Google Workspace/);
  assert.match(loginPage, /Acesso legado temporário/);
  assert.match(loginPage, /type="password"/);
  assert.doesNotMatch(usersPage, /Identificador da conta|name="user_id"|UUID/);
  assert.match(usersPage, /name="email"/);
});

test("implementação não introduz Auth0 nem credenciais administrativas", () => {
  const source = `${authAction}\n${callback}\n${loginPage}\n${usersPage}`;
  assert.doesNotMatch(source, /auth0/i);
  assert.doesNotMatch(source, /service_role|SUPABASE_SECRET_KEY/);
});
