import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const migration = await fs.readFile(
  new URL(
    "../supabase/migrations/202609240006_performance_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);
const searchIndexes = await fs.readFile(
  new URL(
    "../supabase/migrations/202609250002_order_search_performance_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("índices de performance correspondem às consultas documentadas", () => {
  assert.match(migration, /create extension if not exists pg_trgm/i);
  assert.match(
    migration,
    /os_orders_active_title_trgm[\s\S]+gin\(title extensions\.gin_trgm_ops\)[\s\S]+where active/i,
  );
  assert.match(
    migration,
    /os_orders_active_created_at[\s\S]+\(created_at desc\)[\s\S]+where active/i,
  );
  assert.match(
    migration,
    /os_attachments_order_date[\s\S]+\(order_id,created_at desc\)/i,
  );
  assert.match(migration, /os_units_name_trgm/i);
  assert.match(migration, /os_catalogs_name_trgm/i);
});

test("índices finais atendem filtros e cursor realmente usados", () => {
  assert.match(
    searchIndexes,
    /os_orders_active_created_cursor[\s\S]+\(created_at desc,id desc\)[\s\S]+where active/i,
  );
  assert.doesNotMatch(searchIndexes, /active_category_cursor/i);
  assert.doesNotMatch(searchIndexes, /active_destination_cursor/i);
  assert.doesNotMatch(searchIndexes, /active_opened_at/i);
  assert.doesNotMatch(searchIndexes, /active_completed_at/i);
  assert.doesNotMatch(searchIndexes, /active_reopened_cursor/i);
  assert.doesNotMatch(searchIndexes, /priority.*index|index.*priority/i);
  assert.doesNotMatch(searchIndexes, /protocol.*index|index.*protocol/i);
});

test("migration substitui o índice de anexos sem perder o prefixo da FK", () => {
  assert.match(
    migration,
    /drop index concurrently if exists public\.os_attachments_order/i,
  );
  assert.match(
    migration,
    /create index concurrently if not exists os_attachments_order_date[\s\S]+\(order_id,created_at desc\)/i,
  );
});
