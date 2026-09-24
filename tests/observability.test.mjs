import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRequestId,
  structuredLogRecord,
} from "../src/lib/observability.ts";

test("aceita somente correlation IDs no formato UUID", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(normalizeRequestId(id.toUpperCase()), id);
  assert.equal(normalizeRequestId("valor\nforjado"), null);
  assert.equal(normalizeRequestId(""), null);
});

test("log estruturado não inclui mensagem nem detalhes arbitrários do erro", () => {
  const error = Object.assign(new Error("senha ou dado pessoal"), {
    code: "DB_TIMEOUT",
    details: "conteúdo sensível",
  });
  const record = structuredLogRecord("error", "query_failed", {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    route: "/ordens?q=dado-pessoal",
    error,
  });
  const serialized = JSON.stringify(record);

  assert.equal(record.route, "/ordens");
  assert.match(serialized, /DB_TIMEOUT/);
  assert.doesNotMatch(serialized, /senha|sensível|dado-pessoal/);
});
