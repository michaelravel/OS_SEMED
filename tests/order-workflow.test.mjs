import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedOrderTransitions,
  canonicalOrderStatuses,
  canonicalOrderStatusNames,
  compatibleOrderStatusSchema,
  isAllowedOrderTransition,
  isTerminalOrderStatus,
  legacyOrderStatusMapping,
  legacyOrderStatusNames,
  normalizeOrderStatus,
  orderOperationNames,
  orderStatusSchema,
  orderTransitionRequestSchema,
  orderWaitReasonNames,
  terminalOrderStatuses,
} from "../src/lib/order-workflow.ts";

const orderId = "123e4567-e89b-42d3-a456-426614174000";

test("estados canônicos são válidos e reabertura não é estado", () => {
  assert.deepEqual(canonicalOrderStatuses, [
    "A conferir",
    "Aberta",
    "Em triagem",
    "Encaminhada",
    "Atribuída",
    "Em atendimento",
    "Aguardando informação",
    "Concluída",
    "Cancelada",
  ]);
  for (const status of canonicalOrderStatuses)
    assert.equal(orderStatusSchema.safeParse(status).success, true);
  assert.equal(orderStatusSchema.safeParse("Reaberta").success, false);
  assert.equal(orderStatusSchema.safeParse("Em análise").success, false);
});

test("todas as transições declaradas são válidas no helper e no schema", () => {
  for (const transition of allowedOrderTransitions) {
    assert.equal(
      isAllowedOrderTransition(
        transition.from,
        transition.to,
        transition.operation,
      ),
      true,
    );
    assert.equal(
      orderTransitionRequestSchema.safeParse({
        id: orderId,
        ...transition,
        reason: "",
      }).success,
      true,
    );
  }
});

test("rejeita saltos, operações incompatíveis e reabertura fora de terminal", () => {
  assert.equal(
    isAllowedOrderTransition(
      canonicalOrderStatusNames.open,
      canonicalOrderStatusNames.assigned,
    ),
    false,
  );
  assert.equal(
    isAllowedOrderTransition(
      canonicalOrderStatusNames.open,
      canonicalOrderStatusNames.triage,
      orderOperationNames.complete,
    ),
    false,
  );
  assert.equal(
    isAllowedOrderTransition(
      canonicalOrderStatusNames.inService,
      canonicalOrderStatusNames.triage,
      orderOperationNames.reopen,
    ),
    false,
  );
  assert.equal(
    orderTransitionRequestSchema.safeParse({
      id: orderId,
      from: canonicalOrderStatusNames.completed,
      to: canonicalOrderStatusNames.open,
      operation: orderOperationNames.reopen,
      reason: "Reabrir",
    }).success,
    false,
  );
});

test("somente conclusão e cancelamento são estados terminais", () => {
  assert.deepEqual(terminalOrderStatuses, ["Concluída", "Cancelada"]);
  for (const status of canonicalOrderStatuses)
    assert.equal(
      isTerminalOrderStatus(status),
      status === "Concluída" || status === "Cancelada",
    );
});

test("mapeia estados legados sem perder o motivo de espera", () => {
  assert.deepEqual(legacyOrderStatusMapping, {
    "Em análise": { status: "Em triagem" },
    "Em execução": { status: "Em atendimento" },
    "Aguardando material": {
      status: "Aguardando informação",
      waitingReason: "material",
    },
    "Aguardando deslocamento/logística": {
      status: "Aguardando informação",
      waitingReason: "logística",
    },
  });
  assert.deepEqual(normalizeOrderStatus(legacyOrderStatusNames.analyzing), {
    status: canonicalOrderStatusNames.triage,
  });
  assert.deepEqual(normalizeOrderStatus(legacyOrderStatusNames.executing), {
    status: canonicalOrderStatusNames.inService,
  });
  assert.deepEqual(normalizeOrderStatus(legacyOrderStatusNames.waitingMaterial), {
    status: canonicalOrderStatusNames.waitingInformation,
    waitingReason: orderWaitReasonNames.material,
  });
  assert.deepEqual(
    normalizeOrderStatus(legacyOrderStatusNames.waitingLogistics),
    {
      status: canonicalOrderStatusNames.waitingInformation,
      waitingReason: orderWaitReasonNames.logistics,
    },
  );
  assert.equal(
    compatibleOrderStatusSchema.safeParse(legacyOrderStatusNames.analyzing)
      .success,
    true,
  );
  assert.equal(normalizeOrderStatus("Estado desconhecido"), null);
});
