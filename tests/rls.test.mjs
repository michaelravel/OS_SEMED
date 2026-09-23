import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { mapSeed } from "../scripts/import-lib.mjs";
const migration = await fs.readFile(
  new URL("../supabase/migrations/202609230001_os_semed.sql", import.meta.url),
  "utf8",
);
test("migration e RLS isolam unidades, identidades, operações e anexos", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;`);
    await db.exec(migration);
    const ids = Array.from(
      { length: 12 },
      (_, i) => `00000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`,
    );
    const [
      admin,
      owner,
      other,
      tech,
      manager,
      unbound,
      schoolManager,
      unitA,
      unitB,
      orderA,
      orderB,
      cat,
    ] = ids;
    await db.exec(`insert into auth.users(id) values ${ids
      .slice(0, 7)
      .map((id) => `('${id}')`)
      .join(",")};
      insert into os_profiles(id,name) select id,'Teste' from auth.users;
      insert into os_units(id,name) values('${unitA}','A'),('${unitB}','B');
      insert into os_catalogs(id,legacy_id,kind,name) values('${cat}','L1','logistics','Categoria');
      insert into os_memberships(user_id,unit_id,role) values
      ('${admin}',null,'admin'),('${owner}','${unitA}','solicitante'),('${other}','${unitB}','solicitante'),
      ('${tech}','${unitA}','responsavel'),('${manager}',null,'gestor'),('${schoolManager}','${unitA}','gestor');
      insert into os_orders(id,unit_id,opened_by,responsible_id,category_id,title) values
      ('${orderA}','${unitA}','${owner}','${tech}','${cat}','Ordem A'),('${orderB}','${unitB}','${other}',null,'${cat}','Ordem B');`);
    async function asUser(id, sql) {
      await db.exec(
        `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
      );
      return db.query(sql);
    }
    const visible = async (id) =>
      (await asUser(id, "select id from os_orders order by id")).rows.map(
        (r) => r.id,
      );
    assert.deepEqual(await visible(admin), [orderA, orderB]);
    assert.deepEqual(await visible(manager), [orderA, orderB]);
    assert.deepEqual(await visible(owner), [orderA]);
    assert.deepEqual(await visible(other), [orderB]);
    assert.deepEqual(await visible(tech), [orderA]);
    assert.deepEqual(await visible(schoolManager), [orderA]);
    assert.deepEqual(await visible(unbound), []);
    assert.deepEqual(
      (await asUser(owner, "select id from os_units")).rows.map((r) => r.id),
      [unitA],
    );
    assert.equal(
      (await asUser(unbound, "select id from os_catalogs")).rows.length,
      0,
    );
    await assert.rejects(
      asUser(
        owner,
        `insert into os_orders(unit_id,opened_by,title) values('${unitB}','${owner}','Invasão')`,
      ),
    );
    await assert.rejects(
      asUser(
        owner,
        `insert into os_memberships(user_id,role) values('${owner}','admin')`,
      ),
    );
    assert.equal(
      (
        await asUser(
          tech,
          `update os_orders set title='Alterada' where id='${orderA}' returning id`,
        )
      ).rows.length,
      0,
    );
    await asUser(tech, `select os_change_status('${orderA}','Em execução')`);
    await assert.rejects(
      asUser(tech, `select os_change_status('${orderB}','Concluída')`),
    );
    await assert.rejects(
      asUser(manager, `select os_change_status('${orderA}','Concluída')`),
    );
    await assert.rejects(
      asUser(owner, `select os_change_status('${orderA}','Concluída')`),
    );
    await assert.rejects(
      asUser(admin, `select os_change_status('${orderA}','INVÁLIDO')`),
    );
    await asUser(
      owner,
      `insert into os_messages(order_id,body) values('${orderA}','Mensagem')`,
    );
    await assert.rejects(
      asUser(
        other,
        `insert into os_messages(order_id,body) values('${orderA}','Mensagem')`,
      ),
    );
    await assert.rejects(
      asUser(
        owner,
        `insert into os_messages(order_id,author_id,body) values('${orderA}','${admin}','Falsificada')`,
      ),
    );
    await assert.rejects(
      asUser(
        manager,
        `insert into os_messages(order_id,body) values('${orderA}','Mensagem')`,
      ),
    );
    assert.equal(
      (await asUser(owner, "select id from os_audit")).rows.length,
      0,
    );
    assert.ok((await asUser(admin, "select id from os_audit")).rows.length > 0);
    const attachment = "00000000-0000-4000-a000-000000000099";
    await asUser(
      owner,
      `insert into os_attachments(id,order_id,name,path,mime_type,size_bytes) values('${attachment}','${orderA}','a.pdf','${orderA}/${attachment}','application/pdf',10)`,
    );
    await asUser(
      owner,
      `insert into storage.objects(bucket_id,name) values('os-attachments','${orderA}/${attachment}')`,
    );
    assert.equal(
      (await asUser(other, "select id from storage.objects")).rows.length,
      0,
    );
    await assert.rejects(
      asUser(
        other,
        `insert into storage.objects(bucket_id,name) values('os-attachments','${orderA}/${attachment}')`,
      ),
    );
    await assert.rejects(
      asUser(
        owner,
        `insert into storage.objects(bucket_id,name) values('os-attachments','${orderB}/${attachment}')`,
      ),
    );
    await asUser(
      admin,
      `update os_memberships set active=false where user_id='${owner}'`,
    );
    assert.deepEqual(await visible(owner), []);
    await db.exec("reset role; set role anon;");
    await assert.rejects(db.query("select id from os_orders"));
    await assert.rejects(db.query("select os_change_status(null,'Aberta')"));
    await db.exec("reset role;");
    const unsecured = await db.query(
      "select tablename from pg_tables where schemaname='public' and tablename like 'os_%' and not rowsecurity",
    );
    assert.equal(unsecured.rows.length, 0);
    // Executa a conversão real no schema, incluindo reexecução sem sobrescrita.
    await db.exec("select set_config('request.jwt.claim.sub','',false);");
    const seedText = await fs.readFile(
      new URL("../assets/seed-data.js", import.meta.url),
      "utf8",
    );
    const seed = JSON.parse(
      seedText
        .replace(/^\uFEFF?\s*window\.DIRLOGISTICA_SEED\s*=\s*/, "")
        .replace(/;\s*$/, ""),
    );
    const imported = mapSeed(seed);
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const [table, rows, columns] of [
        [
          "os_units",
          imported.units,
          "id,legacy_id,name,type,address,coordinates,active",
        ],
        [
          "os_catalogs",
          imported.catalogs,
          "id,legacy_id,kind,name,data,active",
        ],
        [
          "os_orders",
          imported.orders,
          "id,legacy_id,unit_id,opened_by,responsible_id,category_id,title,status,details,opened_at,active",
        ],
        ["os_import_records", imported.original, "source,source_id,payload"],
      ]) {
        await db.query(
          `insert into ${table}(${columns}) select ${columns} from jsonb_populate_recordset(null::${table},$1) on conflict do nothing`,
          [JSON.stringify(rows)],
        );
      }
    }
    assert.equal(
      (await db.query("select id from os_orders where legacy_id is not null"))
        .rows.length,
      5,
    );
    assert.equal(
      (await db.query("select id from os_catalogs")).rows.length,
      535,
    );
    const archived = await db.query(
      "select payload from os_import_records where source='seed/ABERTURA_OS' order by source_id",
    );
    assert.equal(archived.rows.length, 5);
  } finally {
    await db.close();
  }
});
