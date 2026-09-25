import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  firstAuthorizedRoute,
  navigationContext,
  visibleNavigationItems,
} from "../src/lib/navigation.ts";

const read = (path) =>
  fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("primeira rota segue a primeira área realmente autorizada", () => {
  assert.equal(firstAuthorizedRoute(new Set(["dashboard.view"]), false), "/painel");
  assert.equal(firstAuthorizedRoute(new Set(["orders.view"]), false), "/ordens");
  assert.equal(firstAuthorizedRoute(new Set(), false), "/sem-acesso");

  const nonAdministrator = visibleNavigationItems(
    new Set(["audit.view", "orders.view"]),
    false,
  );
  assert.deepEqual(nonAdministrator.map((item) => item.href), ["/ordens"]);
});

test("menu agrupa cadastros e omite grupos sem itens permitidos", () => {
  const ordersOnly = visibleNavigationItems(new Set(["orders.view"]), false);
  assert.equal(ordersOnly.some((item) => item.section === "catalogs"), false);
  assert.equal(
    ordersOnly.some((item) => item.section === "administration"),
    false,
  );

  const administrator = visibleNavigationItems(
    new Set([
      "dashboard.view",
      "orders.view",
      "units.view",
      "logistics.view",
      "routes.view",
      "vehicles.view",
      "drivers.view",
      "professionals.view",
      "professionals.manage",
      "audit.view",
    ]),
    true,
  );
  assert.ok(administrator.some((item) => item.section === "catalogs"));
  assert.ok(administrator.some((item) => item.section === "administration"));
});

test("breadcrumb e cabeçalho representam a rota real", () => {
  assert.deepEqual(navigationContext("/painel").breadcrumbs, [
    { label: "Início" },
  ]);
  assert.deepEqual(navigationContext("/ordens/nova").breadcrumbs, [
    { label: "Ordens de Serviço", href: "/ordens" },
    { label: "Nova" },
  ]);
  assert.deepEqual(navigationContext("/ordens/uuid-da-os").breadcrumbs, [
    { label: "Ordens de Serviço", href: "/ordens" },
    { label: "Detalhes" },
  ]);
  assert.equal(
    navigationContext("/usuarios").breadcrumbs[0].label,
    "Cadastros",
  );
  assert.equal(
    navigationContext("/perfis").breadcrumbs[0].label,
    "Administração",
  );
});

test("Nova OS aparece somente na listagem de ordens e exige permissão", async () => {
  const [shell, dashboard, orders, newOrder, professionals, profiles] =
    await Promise.all([
      read("src/components/shell.tsx"),
      read("src/app/(app)/painel/page.tsx"),
      read("src/app/(app)/ordens/page.tsx"),
      read("src/app/(app)/ordens/nova/page.tsx"),
      read("src/app/(app)/usuarios/page.tsx"),
      read("src/app/(app)/perfis/page.tsx"),
    ]);

  assert.doesNotMatch(shell, /href="\/ordens\/nova"/);
  assert.match(orders, /permissions\.has\(routePermissions\.newOrder\)/);
  assert.match(orders, /href="\/ordens\/nova"/);
  for (const source of [dashboard, newOrder, professionals, profiles])
    assert.doesNotMatch(source, /href="\/ordens\/nova"/);
});

test("login legado, OAuth e raiz compartilham o resolvedor de destino", async () => {
  const [auth, callback, root, notFound] = await Promise.all([
    read("src/app/actions/auth.ts"),
    read("src/app/auth/callback/route.ts"),
    read("src/app/page.tsx"),
    read("src/app/not-found.tsx"),
  ]);
  for (const source of [auth, callback, root])
    assert.match(source, /resolveFirstAuthorizedRoute/);
  assert.doesNotMatch(`${auth}\n${callback}\n${root}`, /redirect\("\/painel"\)/);
  assert.match(notFound, /href="\/"/);
});
