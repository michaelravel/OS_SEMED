import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const filters = await fs.readFile(
  new URL("../src/components/order-filters.tsx", import.meta.url),
  "utf8",
);
const page = await fs.readFile(
  new URL("../src/app/(app)/ordens/page.tsx", import.meta.url),
  "utf8",
);
const migration = await fs.readFile(
  new URL("../supabase/migrations/202609250001_order_search.sql", import.meta.url),
  "utf8",
);

test("interface oferece todos os filtros e os persiste como parâmetros GET", () => {
  for (const name of [
    "q",
    "protocol",
    "status",
    "priority",
    "category",
    "origin",
    "destination",
    "requester",
    "responsible",
    "opened_from",
    "opened_to",
    "completed_from",
    "completed_to",
    "reopened",
    "waiting",
  ]) {
    assert.ok(filters.includes(`name="${name}"`), `filtro ${name} ausente`);
  }
  assert.match(filters, /method="get"/i);
  assert.ok(page.includes("orderFilterUrlParams"));
});

test("listagem usa pesquisa protegida e cursor composto", () => {
  assert.ok(page.includes('db.rpc("os_search_orders"'));
  assert.ok(page.includes('db.rpc("os_order_filter_options"'));
  assert.ok(!page.includes(".range("));
  assert.match(
    migration,
    /\(b\.created_at,b\.id\)<\(cursor_created_at,cursor_id\)/i,
  );
  assert.match(
    migration,
    /\(b\.created_at,b\.id\)>\(cursor_created_at,cursor_id\)/i,
  );
  assert.match(migration, /order by p\.created_at desc,p\.id desc/i);
  assert.match(migration, /os_private\.can_read_order\(o\)/i);
});
