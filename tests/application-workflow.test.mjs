import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const actions = await fs.readFile(
  new URL("../src/app/actions/orders.ts", import.meta.url),
  "utf8",
);
const workflowUi = await fs.readFile(
  new URL(
    "../src/components/order-details/order-workflow-actions.tsx",
    import.meta.url,
  ),
  "utf8",
);
const summaryUi = await fs.readFile(
  new URL(
    "../src/components/order-details/order-summary.tsx",
    import.meta.url,
  ),
  "utf8",
);
const serviceUi = await fs.readFile(
  new URL(
    "../src/components/order-details/order-service.tsx",
    import.meta.url,
  ),
  "utf8",
);
const headerUi = await fs.readFile(
  new URL("../src/components/order-details/order-header.tsx", import.meta.url),
  "utf8",
);
const cycleUi = await fs.readFile(
  new URL("../src/components/order-details/order-cycle.tsx", import.meta.url),
  "utf8",
);
const activityUi = await fs.readFile(
  new URL("../src/components/order-details/order-activity.tsx", import.meta.url),
  "utf8",
);

test("Server Actions usam uma RPC específica e tratamento seguro por operação", () => {
  const contracts = [
    ["reconcileOrder", "os_reconcile_order", "RECONCILE"],
    ["startTriage", "os_start_triage", "TRIAGE"],
    ["forwardOrder", "os_forward_order", "FORWARD"],
    ["assignOrder", "os_assign_order", "ASSIGN"],
    ["reassignOrder", "os_reassign_order", "REASSIGN"],
    ["startService", "os_start_service", "START_SERVICE"],
    ["addServiceEntry", "os_add_service_entry", "ADD_SERVICE_ENTRY"],
    ["waitForInformation", "os_wait_for_information", "WAIT_INFORMATION"],
    ["resumeService", "os_resume_service", "RESUME"],
    ["completeOrder", "os_complete_order", "COMPLETE"],
    ["cancelOrder", "os_cancel_order", "CANCEL"],
    ["reopenOrder", "os_reopen_order", "REOPEN"],
    ["editOrderControlled", "os_edit_order_controlled", "EDIT"],
  ];

  for (const [action, rpc, operation] of contracts) {
    const start = actions.indexOf(`export async function ${action}`);
    assert.notEqual(start, -1, `${action} ausente`);
    const next = actions.indexOf("\nexport async function ", start + 1);
    const body = actions.slice(start, next === -1 ? undefined : next);
    assert.match(body, /safeParse\(/, `${action} sem validação Zod`);
    assert.match(body, /await session\(\)/, `${action} sem sessão`);
    assert.ok(body.includes(`db.rpc("${rpc}"`), `${action} não chama ${rpc}`);
    assert.ok(
      body.includes("orderActionFailed(") && body.includes(`"${operation}"`),
      `${action} sem erro público padronizado`,
    );
    assert.match(body, /refreshOrder\(id\)/, `${action} sem revalidação`);
  }
});

test("interface usa o contrato de operações e não o avanço genérico", () => {
  for (const operation of [
    "reconcile",
    "triage",
    "forward",
    "assign",
    "reassign",
    "startService",
    "waitInformation",
    "resume",
    "complete",
    "cancel",
    "reopen",
  ])
    assert.ok(
      workflowUi.includes(`workflowActionNames.${operation}`),
      `operação ${operation} não renderizada`,
    );
  assert.ok(!summaryUi.includes("changeStatus"));
  assert.ok(!summaryUi.includes("next_status"));
  assert.ok(serviceUi.includes("addServiceEntry"));
  assert.ok(serviceUi.includes("serviceEntryTypes"));
});

test("detalhe apresenta cabeçalho, ciclo e separa atendimento de comunicação", () => {
  for (const label of [
    "Categoria",
    "Solicitante",
    "Unidade de origem",
    "Unidade executora",
    "Responsável",
  ]) {
    assert.ok(headerUi.includes(label), `cabeçalho deveria exibir ${label}`);
  }
  assert.ok(headerUi.includes("OS aguardando conferência"));
  assert.ok(cycleUi.includes("buildOrderCycle"));
  assert.ok(cycleUi.includes("Aguardando informação"));
  assert.ok(
    serviceUi.toUpperCase().includes("REGISTRO FORMAL DE ATENDIMENTO"),
  );
  assert.ok(activityUi.includes("COMUNICAÇÃO"));
  assert.ok(!activityUi.includes("serviceEntries"));
});
