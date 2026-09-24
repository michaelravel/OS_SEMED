import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const directory = new URL("../supabase/backfills/", import.meta.url);
const [preflight, backfill, validation] = await Promise.all([
  fs.readFile(new URL("202609240008_order_flow_preflight.sql", directory), "utf8"),
  fs.readFile(new URL("202609240008_order_flow_backfill.sql", directory), "utf8"),
  fs.readFile(new URL("202609240008_order_flow_validation.sql", directory), "utf8"),
]);

test("preflight e validação são estritamente somente leitura", () => {
  for (const sql of [preflight, validation]) {
    assert.match(sql, /begin transaction read only/i);
    assert.doesNotMatch(sql, /^\s*(insert|update|delete|alter|create|drop|truncate)\b/im);
  }
});

test("backfill contém os quatro mapeamentos determinísticos", () => {
  assert.match(backfill, /when 'Em análise' then target_status := 'Em triagem'/i);
  assert.match(backfill, /when 'Em execução' then target_status := 'Em atendimento'/i);
  assert.match(backfill, /when 'Aguardando material'[\s\S]+target_waiting_reason := 'material'/i);
  assert.match(backfill, /when 'Aguardando deslocamento\/logística'[\s\S]+target_waiting_reason := 'logística'/i);
});

test("backfill preserva identificadores e não inventa vínculos ou datas", () => {
  assert.match(backfill, /o\.protocol is distinct from b\.protocol/i);
  assert.match(backfill, /o\.legacy_id is distinct from b\.legacy_id/i);
  assert.match(backfill, /target_protocol_code := current_order\.protocol::text/i);
  assert.match(backfill, /protocol_year_source_missing/i);
  assert.doesNotMatch(backfill, /set[\s\S]{0,200}(responsible_id|unit_id|destination_unit_id|opened_at|triaged_at|forwarded_at|assigned_at|service_started_at)\s*=/i);
});

test("reexecução não duplica eventos nem exceções auditadas", () => {
  assert.match(backfill, /where not exists\([\s\S]+event_type = 'workflow_backfill'/i);
  assert.match(backfill, /where not exists\([\s\S]+a\.entity = 'os_order_flow_backfill'/i);
  assert.match(backfill, /on conflict do nothing/i);
});
