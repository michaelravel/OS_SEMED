import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const migration = await fs.readFile(
  new URL(
    "../supabase/migrations/202609240007_additive_order_flow_schema.sql",
    import.meta.url,
  ),
  "utf8",
);

test("migration amplia o status sem remover valores legados", () => {
  for (const status of [
    "A conferir",
    "Aberta",
    "Em triagem",
    "Encaminhada",
    "Atribuída",
    "Em atendimento",
    "Aguardando informação",
    "Concluída",
    "Cancelada",
    "Em análise",
    "Em execução",
    "Aguardando material",
    "Aguardando deslocamento/logística",
  ]) {
    assert.match(migration, new RegExp(`'${status}'`, "u"));
  }
});

test("campos do fluxo são aditivos e somente version possui default", () => {
  for (const column of [
    "protocol_year",
    "protocol_code",
    "destination_unit_id",
    "triaged_at",
    "forwarded_at",
    "assigned_at",
    "service_started_at",
    "waiting_since",
    "waiting_reason",
    "waiting_details",
    "resume_status",
    "priority_reason",
  ]) {
    assert.match(migration, new RegExp(`add column ${column}\\b`, "i"));
  }
  assert.match(migration, /add column version bigint not null default 1/i);
  assert.doesNotMatch(migration, /update\s+public\.os_orders/i);
  assert.doesNotMatch(migration, /update\s+public\.os_order_events/i);
});

test("atendimentos e anexos preservam a identidade da OS", () => {
  assert.match(migration, /create table public\.os_order_service_entries/i);
  assert.match(
    migration,
    /foreign key\(service_entry_id,order_id\)[\s\S]+references public\.os_order_service_entries\(id,order_id\)/i,
  );
  assert.match(migration, /alter table public\.os_order_service_entries enable row level security/i);
  assert.match(migration, /revoke all on public\.os_order_service_entries from anon, authenticated/i);
});

test("eventos recebem campos opcionais sem reescrever o histórico", () => {
  for (const column of [
    "event_type",
    "actor_membership_id",
    "metadata",
    "operation",
  ]) {
    assert.match(migration, new RegExp(`add column ${column}\\b`, "i"));
  }
  assert.match(migration, /metadata is null or jsonb_typeof\(metadata\) = 'object'/i);
});
