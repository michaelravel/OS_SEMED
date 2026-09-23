import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { mapSeed } from "./import-lib.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "source-data", "DIRLOGISTICA-314837652");
const seedText = await fs.readFile(
  path.join(root, "assets", "seed-data.js"),
  "utf8",
);
// Parse como JSON, sem executar conteúdo JavaScript dos arquivos de origem.
const seed = JSON.parse(
  seedText
    .replace(/^\uFEFF?\s*window\.DIRLOGISTICA_SEED\s*=\s*/, "")
    .replace(/;\s*$/, ""),
);
const mapped = mapSeed(seed);
const sources = [];
const archive = [...mapped.original];
for (const file of (await fs.readdir(sourceDir)).sort()) {
  const bytes = await fs.readFile(path.join(sourceDir, file));
  sources.push({
    file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  if (file.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row, rowNumber) => {
        archive.push({
          source: `xlsx/${file}/${sheet.name}`,
          source_id: String(rowNumber),
          payload: { cells: row.values },
        });
      });
    }
  } else if (file.endsWith(".csv")) {
    const rows = parse(bytes, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
    });
    rows.forEach((row, i) =>
      archive.push({
        source: `csv/${file}`,
        source_id: String(i + 1),
        payload: row,
      }),
    );
  }
}
const payload = {
  os_units: mapped.units,
  os_catalogs: mapped.catalogs,
  os_orders: mapped.orders,
  os_import_records: archive,
};
const output = path.join(root, "migration-output");
await fs.mkdir(output, { recursive: true });
await fs.writeFile(
  path.join(output, "payload.json"),
  JSON.stringify(payload, null, 2),
);
const report = {
  generated_at: new Date().toISOString(),
  source_manifest: sources,
  counts: Object.fromEntries(
    Object.entries(payload).map(([k, v]) => [k, v.length]),
  ),
  warnings: mapped.warnings,
  notes: [
    "Usuários/senhas demo não importados.",
    "Dados existentes somente no navegador não estão nestes arquivos.",
    "Referências de anexos preservadas; arquivos binários não presentes precisam ser fornecidos.",
    "Planilhas e CSV arquivados integralmente em os_import_records, incluindo cabeçalhos e células com fórmulas.",
  ],
};
await fs.writeFile(
  path.join(output, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      counts: report.counts,
      warnings: report.warnings.length,
      output: "migration-output/ (privado, ignorado no Git)",
    },
    null,
    2,
  ),
);
