import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionErrorMessages,
  classifyOrderRpcError,
} from "../src/lib/action-result.ts";

test("classifica conflitos e autorização sem retornar detalhes internos", () => {
  assert.equal(
    classifyOrderRpcError({ message: "A ordem foi alterada por outro usuário" }),
    "conflict",
  );
  assert.equal(
    classifyOrderRpcError({ code: "42501", message: "permission denied" }),
    "forbidden",
  );
  assert.equal(
    classifyOrderRpcError({ message: "Ordem não encontrada" }),
    "not_found",
  );
  assert.equal(
    classifyOrderRpcError({ message: "Conclusão não permitida no status atual" }),
    "business_rule",
  );
  assert.equal(
    classifyOrderRpcError({ message: "connection string secret-value" }),
    "unexpected",
  );
  assert.ok(
    Object.values(actionErrorMessages).every(
      (message) => !message.includes("secret-value"),
    ),
  );
});
