import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachmentContentMatches,
  attachmentExtensionMatches,
  attachmentSha256,
  normalizeAttachmentName,
} from "../src/lib/attachments.ts";

test("normaliza nomes de anexos e remove controles e caminhos", () => {
  assert.equal(
    normalizeAttachmentName("  ../Relatório\u0000\n final.PDF  "),
    "_Relatório__ final.PDF",
  );
  assert.equal(normalizeAttachmentName("CON.txt"), "_CON.txt");
  assert.equal(normalizeAttachmentName("..."), "");
  assert.ok(normalizeAttachmentName(`${"a".repeat(250)}.pdf`).length <= 180);
});

test("exige extensão coerente e assinatura básica do conteúdo", async () => {
  assert.equal(
    attachmentExtensionMatches("arquivo.pdf", "application/pdf"),
    true,
  );
  assert.equal(
    attachmentExtensionMatches("arquivo.exe", "application/pdf"),
    false,
  );
  assert.equal(
    await attachmentContentMatches(
      new File(
        [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])],
        "a.pdf",
        {
          type: "application/pdf",
        },
      ),
    ),
    true,
  );
  assert.equal(
    await attachmentContentMatches(
      new File(["não é pdf"], "a.pdf", { type: "application/pdf" }),
    ),
    false,
  );
});

test("gera SHA-256 do conteúdo antes do upload", async () => {
  assert.equal(
    await attachmentSha256(new File(["abc"], "a.txt", { type: "text/plain" })),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
