import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mapSeed, stableId } from "../scripts/import-lib.mjs";
const seed = JSON.parse(
  fs
    .readFileSync(new URL("../assets/seed-data.js", import.meta.url), "utf8")
    .replace(/^\uFEFF?\s*window\.DIRLOGISTICA_SEED\s*=\s*/, "")
    .replace(/;\s*$/, ""),
);
test("todos os registros do seed são preservados sem inferir identidade/status", () => {
  const result = mapSeed(seed);
  assert.equal(result.units.length, 93);
  assert.equal(result.catalogs.length, 534);
  assert.equal(result.orders.length, 5);
  assert.equal(
    result.original.length,
    Object.values(seed).reduce((n, rows) => n + rows.length, 0),
  );
  assert.deepEqual(mapSeed(seed), result);
  for (const o of result.orders) {
    assert.equal(o.status, "A conferir");
    assert.equal(o.opened_by, null);
    assert.equal(o.responsible_id, null);
    assert.equal(o.import_source, "seed/ABERTURA_OS");
    assert.equal(o.import_source_id, o.legacy_id);
  }
  assert.equal(result.orders.filter((o) => o.category_id).length, 4);
  assert.equal(result.orders.filter((o) => !o.category_id).length, 1);
  assert.equal(
    new Set(
      [...result.units, ...result.catalogs, ...result.orders].map((r) => r.id),
    ).size,
    632,
  );
});
test("homônimos e chaves de origem duplicadas não causam vínculo ou perda", () => {
  const result = mapSeed({
    UNIDADES: [
      { "Row ID": "x", "NOME DA UNIDADE": "A" },
      { "Row ID": "x", "NOME DA UNIDADE": "A" },
    ],
    ABERTURA_OS: [{ ID: "1", ESTABELECIMENTO: "A" }],
  });
  assert.notEqual(result.units[0].id, result.units[1].id);
  assert.equal(result.orders[0].unit_id, null);
  assert.equal(result.original.length, 3);
  assert.match(
    stableId("a", "b"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
