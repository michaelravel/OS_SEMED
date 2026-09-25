import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  orderTimelineEventLabel,
  orderTimelineTransition,
} from "../src/lib/order-timeline.ts";

const migration = await fs.readFile(
  new URL(
    "../supabase/migrations/202609240012_order_functional_timeline.sql",
    import.meta.url,
  ),
  "utf8",
);

test("traduz eventos funcionais sem expor nomes técnicos", () => {
  assert.equal(orderTimelineEventLabel("order_opened", null), "Abertura");
  assert.equal(
    orderTimelineEventLabel("service_entry_added", "Em atendimento"),
    "Registro de atendimento",
  );
  assert.equal(
    orderTimelineEventLabel("evento_futuro", "Em triagem"),
    "Evento da ordem",
  );
  assert.equal(orderTimelineEventLabel(null, "Aberta"), "Alteração de situação");
});

test("apresenta somente transições reais", () => {
  assert.equal(orderTimelineTransition("Aberta", "Em triagem"), "Aberta → Em triagem");
  assert.equal(orderTimelineTransition("Em triagem", "Em triagem"), null);
  assert.equal(orderTimelineTransition(null, "Aberta"), null);
});

test("projeção pagina, filtra autorização e não retorna metadata", () => {
  assert.match(migration, /create function public\.os_order_timeline/i);
  assert.match(migration, /os_private\.can_read_order_event\(e\.order_id,e\.event_type\)/i);
  assert.match(migration, /limit page_size offset page_offset/i);
  const returnContract = migration.match(/returns table\(([\s\S]*?)\) language plpgsql/i)?.[1] ?? "";
  assert.doesNotMatch(returnContract, /\bmetadata\b/i);
  assert.doesNotMatch(returnContract, /actor_membership_id/i);
  assert.match(migration, /attachment_ready_functional_event/i);
  assert.match(
    migration,
    /event_type='order_edited'[\s\S]+priority_changed'[\s\S]+then 'priority_changed'/i,
  );
});
