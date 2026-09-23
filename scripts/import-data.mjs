import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!projectUrl || !secret)
  throw new Error(
    "Configure URL e chave administrativa somente no ambiente local.",
  );
const target = new URL(projectUrl).hostname;
if (process.argv[2] !== "--apply" || process.argv[3] !== target)
  throw new Error(
    `Revisar relatório e schema antes de executar: npm run data:import -- --apply ${target}`,
  );
const db = createClient(projectUrl, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const payload = JSON.parse(
  await fs.readFile(
    new URL("../migration-output/payload.json", import.meta.url),
    "utf8",
  ),
);
// Reexecução não sobrescreve registros já importados ou alterados pela equipe.
// Lotes não são uma transação única: falha interrompe e reexecução retoma por IDs determinísticos.
for (const table of [
  "os_units",
  "os_catalogs",
  "os_orders",
  "os_import_records",
]) {
  const rows = payload[table];
  if (!Array.isArray(rows)) throw new Error(`Payload ausente: ${table}`);
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db
      .from(table)
      .upsert(rows.slice(i, i + 100), {
        onConflict: table === "os_import_records" ? "source,source_id" : "id",
        ignoreDuplicates: true,
      });
    if (error)
      throw new Error(
        `Importação interrompida em ${table}, lote ${i / 100 + 1}; código ${error.code}. Nenhum dado existente foi sobrescrito.`,
      );
  }
  // Consulta somente IDs; não registra PII ou conteúdo de origem.
  let verified = 0;
  if (table !== "os_import_records")
    for (let i = 0; i < rows.length; i += 100) {
      const { data, error } = await db
        .from(table)
        .select("id")
        .in(
          "id",
          rows.slice(i, i + 100).map((r) => r.id),
        );
      if (error) throw new Error(`Falha ao conferir ${table}`);
      verified += data.length;
    }
  console.log(
    `${table}: ${rows.length} registros processados${table !== "os_import_records" ? `, ${verified} IDs conferidos` : ""}`,
  );
}
