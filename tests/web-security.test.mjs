import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseSecurityHeaders,
  buildContentSecurityPolicy,
  isPrivateRoute,
} from "../src/lib/web-security.ts";

test("mantém somente login, configuração e health check como rotas públicas", () => {
  assert.equal(isPrivateRoute("/login"), false);
  assert.equal(isPrivateRoute("/login/"), false);
  assert.equal(isPrivateRoute("/configuracao"), false);
  assert.equal(isPrivateRoute("/api/health"), false);
  assert.equal(isPrivateRoute("/api/health/"), false);
  assert.equal(isPrivateRoute("/"), true);
  assert.equal(isPrivateRoute("/painel"), true);
  assert.equal(isPrivateRoute("/ordens/123"), true);
  assert.equal(isPrivateRoute("/anexos/123"), true);
  assert.equal(isPrivateRoute("/sem-acesso"), true);
});

test("gera CSP de produção com nonce e origens estritamente necessárias", () => {
  const csp = buildContentSecurityPolicy({
    nonce: "nonce-de-teste",
    supabaseUrl: "https://projeto.supabase.co",
    development: false,
  });

  assert.match(csp, /script-src 'self' 'nonce-nonce-de-teste' 'strict-dynamic'/);
  assert.match(
    csp,
    /connect-src 'self' https:\/\/projeto\.supabase\.co wss:\/\/projeto\.supabase\.co/,
  );
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test("libera apenas os recursos de desenvolvimento exigidos pelo Next", () => {
  const csp = buildContentSecurityPolicy({
    nonce: "dev",
    development: true,
  });

  assert.match(csp, /unsafe-eval/);
  assert.match(csp, /style-src[^;]+unsafe-inline/);
  assert.match(csp, /connect-src[^;]+ws:/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test("expõe o conjunto mínimo de headers estáticos de segurança", () => {
  const headers = new Map(baseSecurityHeaders.map(({ key, value }) => [key, value]));
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("X-XSS-Protection"), "0");
  assert.equal(headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.match(headers.get("Permissions-Policy") ?? "", /camera=\(\)/);
});
