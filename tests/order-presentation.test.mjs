import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderCycle,
  formatOrderProtocol,
} from "../src/lib/order-workflow.ts";

test("formata protocolo formal e mantém fallback legado", () => {
  assert.equal(formatOrderProtocol(42, "42", 2026), "OS 000042/2026");
  assert.equal(formatOrderProtocol(42, null, null), "OS-000042");
});

test("representa etapas canônicas, espera e estados terminais", () => {
  const triage = buildOrderCycle("Em triagem", null);
  assert.deepEqual(
    triage.stages.map(({ state }) => state),
    ["completed", "current", "upcoming", "upcoming", "upcoming", "upcoming"],
  );

  const waiting = buildOrderCycle("Aguardando informação", "Atribuída");
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.stages[3].state, "current");

  const completed = buildOrderCycle("Concluída", null);
  assert.equal(completed.completed, true);
  assert.ok(completed.stages.every(({ state }) => state === "completed"));

  const canceled = buildOrderCycle("Cancelada", null);
  assert.equal(canceled.canceled, true);
  assert.ok(canceled.stages.every(({ state }) => state === "upcoming"));
});

test("mantém estados legados e destaca OS a conferir", () => {
  assert.equal(buildOrderCycle("Em análise", null).stages[1].state, "current");
  assert.equal(buildOrderCycle("Em execução", null).stages[4].state, "current");
  assert.equal(
    buildOrderCycle("Aguardando material", null).stages[4].state,
    "current",
  );
  const review = buildOrderCycle("A conferir", null);
  assert.equal(review.pendingReview, true);
  assert.ok(review.stages.every(({ state }) => state === "upcoming"));
});
