import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { mapSeed } from "../scripts/import-lib.mjs";
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrations = await Promise.all(
  (await fs.readdir(migrationsDirectory))
    // pg_trgm não está disponível no PGlite; índices físicos são validados
    // separadamente e não alteram as regras funcionais/RLS deste teste.
    .filter(
      (file) =>
        file.endsWith(".sql") && !file.endsWith("_performance_indexes.sql"),
    )
    .sort()
    .map((file) => fs.readFile(new URL(file, migrationsDirectory), "utf8")),
);
const relationalRollback = await fs.readFile(
  new URL(
    "../supabase/rollbacks/202609240005_order_relational_integrity.sql",
    import.meta.url,
  ),
  "utf8",
);
const orderFlowBackfill = await fs.readFile(
  new URL(
    "../supabase/backfills/202609240008_order_flow_backfill.sql",
    import.meta.url,
  ),
  "utf8",
);
const [orderFlowPreflight, orderFlowValidation] = await Promise.all([
  fs.readFile(
    new URL(
      "../supabase/backfills/202609240008_order_flow_preflight.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  fs.readFile(
    new URL(
      "../supabase/backfills/202609240008_order_flow_validation.sql",
      import.meta.url,
    ),
    "utf8",
  ),
]);
test("migration e RLS isolam unidades, identidades, operações e anexos", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(
        id uuid default gen_random_uuid(),bucket_id text,name text,
        metadata jsonb not null default '{}',created_at timestamptz not null default now()
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;`);
    await db.exec(migrations[0]);
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
    const legacyOrder = "00000000-0000-4000-a000-000000000100";
    const legacyClosed = "00000000-0000-4000-a000-000000000101";
    const routeUsed = "00000000-0000-4000-a000-000000000110";
    const routeOther = "00000000-0000-4000-a000-000000000111";
    const routeInactive = "00000000-0000-4000-a000-000000000112";
    await db.exec(`insert into auth.users(id) values ${ids
      .slice(0, 7)
      .map((id) => `('${id}')`)
      .join(",")};
      insert into os_profiles(id,name) select id,'Teste' from auth.users;
      insert into os_units(id,name) values('${unitA}','A'),('${unitB}','B');
      insert into os_catalogs(id,legacy_id,kind,name,active) values
      ('${cat}','L1','logistics','Categoria',true),
      ('${routeUsed}','R1','routes','Rota utilizada',true),
      ('${routeOther}','R2','routes','Rota não relacionada',true),
      ('${routeInactive}','R3','routes','Rota inativa',false);
      insert into os_memberships(user_id,unit_id,role) values
      ('${admin}',null,'admin'),('${owner}','${unitA}','solicitante'),('${other}','${unitB}','solicitante'),
      ('${tech}','${unitA}','responsavel'),('${manager}',null,'gestor'),('${schoolManager}','${unitA}','gestor');
      insert into os_orders(id,unit_id,opened_by,responsible_id,category_id,title,details) values
      ('${orderA}','${unitA}','${owner}','${tech}','${cat}','Ordem A','{"route":"${routeUsed}"}'),
      ('${orderB}','${unitB}','${other}',null,'${cat}','Ordem B','{}');
      insert into os_orders(id,title,status) values
      ('${legacyOrder}','Importada pendente','A conferir'),
      ('${legacyClosed}','Encerrada legada','Concluída');`);
    // Simula a atualização de um banco já populado e valida o backfill.
    await db.exec(migrations.slice(1).join("\n"));
    assert.deepEqual(
      (
        await db.query(
          "select public,file_size_limit from storage.buckets where id='os-attachments'",
        )
      ).rows,
      [{ public: false, file_size_limit: 3145728 }],
    );
    const legacyRows = await db.query(
      `select id,status,unit_id,opened_by,category_id,resolution
       from os_orders where id in ('${legacyOrder}','${legacyClosed}') order by id`,
    );
    assert.deepEqual(legacyRows.rows, [
      {
        id: legacyOrder,
        status: "A conferir",
        unit_id: null,
        opened_by: null,
        category_id: null,
        resolution: null,
      },
      {
        id: legacyClosed,
        status: "Concluída",
        unit_id: null,
        opened_by: null,
        category_id: null,
        resolution: null,
      },
    ]);
    const relationalOrder = await db.query(
      `select route_id,requester_membership_id,responsible_membership_id,
        details ? 'route' as route_still_in_details
       from os_orders where id='${orderA}'`,
    );
    assert.equal(relationalOrder.rows[0].route_id, routeUsed);
    assert.ok(relationalOrder.rows[0].requester_membership_id);
    assert.ok(relationalOrder.rows[0].responsible_membership_id);
    assert.equal(relationalOrder.rows[0].route_still_in_details, false);
    await assert.rejects(
      db.query(`update os_orders set driver_id='${routeUsed}' where id='${orderA}'`),
    );
    await assert.rejects(
      db.query(
        `update os_orders set category_id='${routeUsed}' where id='${legacyOrder}'`,
      ),
    );
    await assert.rejects(
      db.query(
        `insert into os_orders(title,status,import_source,import_source_id)
         values('Origem inexistente','A conferir','seed/ABERTURA_OS','ausente')`,
      ),
    );
    await assert.rejects(
      db.query(
        `update os_memberships set role='gestor' where user_id='${owner}' and role='solicitante'`,
      ),
    );
    await assert.rejects(
      db.query(
        `insert into os_units(name) values(' a ')`,
      ),
    );
    await db.query(
      `update os_catalogs set data='{"routeId":"TEST-2"}' where id='${routeOther}'`,
    );
    await assert.rejects(
      db.query(
        `insert into os_catalogs(legacy_id,kind,name,data) values(
          'NEW-duplicate-route','routes','Duplicada','{"routeId":"TEST-2"}'
        )`,
      ),
    );
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
    assert.deepEqual(await visible(admin), [
      orderA,
      orderB,
      legacyOrder,
      legacyClosed,
    ]);
    assert.deepEqual(await visible(manager), [
      orderA,
      orderB,
      legacyOrder,
      legacyClosed,
    ]);
    assert.deepEqual(await visible(owner), [orderA]);
    assert.deepEqual(await visible(other), [orderB]);
    assert.deepEqual(await visible(tech), [orderA]);
    assert.deepEqual(await visible(schoolManager), [orderA]);
    assert.deepEqual(await visible(unbound), []);
    assert.deepEqual(
      (await asUser(owner, "select id from os_units")).rows.map((r) => r.id),
      [unitA],
    );
    const visibleCatalogs = async (id) =>
      (await asUser(id, "select id from os_catalogs order by id")).rows.map(
        (row) => row.id,
      );
    assert.deepEqual(await visibleCatalogs(admin), [
      cat,
      routeUsed,
      routeOther,
      routeInactive,
    ]);
    assert.deepEqual(await visibleCatalogs(manager), [
      cat,
      routeUsed,
      routeOther,
    ]);
    assert.deepEqual(await visibleCatalogs(owner), [
      cat,
      routeUsed,
      routeOther,
    ]);
    assert.deepEqual(await visibleCatalogs(other), [
      cat,
      routeUsed,
      routeOther,
    ]);
    assert.deepEqual(await visibleCatalogs(tech), [cat, routeUsed]);
    assert.deepEqual(await visibleCatalogs(schoolManager), [cat, routeUsed]);
    assert.deepEqual(await visibleCatalogs(unbound), []);
    await assert.rejects(
      asUser(
        owner,
        `insert into os_orders(unit_id,opened_by,title) values('${unitB}','${owner}','Invasão')`,
      ),
    );
    assert.equal(
      (
        await asUser(
          admin,
          `select * from os_order_available_actions('${legacyOrder}')`,
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      asUser(admin, `select os_change_status('${legacyOrder}','Aberta','')`),
    );
    await asUser(
      admin,
      `select os_assign_order('${legacyOrder}','${unitA}',null,'${owner}','${cat}')`,
    );
    assert.deepEqual(
      (
        await asUser(
          admin,
          `select next_status,operation from os_order_available_actions('${legacyOrder}')`,
        )
      ).rows,
      [{ next_status: "Aberta", operation: "advance" }],
    );
    await asUser(
      admin,
      `select os_change_status('${legacyOrder}','Aberta','')`,
    );
    await assert.rejects(
      asUser(
        owner,
        `insert into os_memberships(user_id,role) values('${owner}','admin')`,
      ),
    );
    await assert.rejects(
      asUser(admin, `update os_units set name='Direto' where id='${unitA}'`),
    );
    await assert.rejects(
      asUser(
        admin,
        `update os_catalogs set name='Direto' where id='${routeOther}'`,
      ),
    );
    await assert.rejects(
      asUser(admin, `update os_profiles set name='Direto' where id='${owner}'`),
    );
    await assert.rejects(
      asUser(
        admin,
        `update os_memberships set role='admin',unit_id=null where user_id='${owner}'`,
      ),
    );
    await assert.rejects(
      asUser(
        owner,
        `select os_save_catalog('${routeOther}','routes','Negado','{"routeId":"2"}',true)`,
      ),
    );
    await asUser(admin, `select os_save_unit('${unitA}','A','','','',true)`);
    await asUser(admin, `select os_save_unit('${unitB}','B','','','',false)`);
    assert.deepEqual(await visibleCatalogs(other), []);
    await asUser(admin, `select os_save_unit('${unitB}','B','','','',true)`);
    await asUser(
      admin,
      `select os_save_catalog('${routeOther}','routes','Rota não relacionada','{"routeId":"TEST-2","number":"2","link":"https://example.com"}',true)`,
    );
    await assert.rejects(
      asUser(
        admin,
        `select os_save_catalog('${routeOther}','routes','Inválido','{"secret":"x"}',true)`,
      ),
    );
    await assert.rejects(
      asUser(owner, `select os_grant_admin('${unbound}','Admin 2',null)`),
    );
    await asUser(admin, `select os_grant_admin('${unbound}','Admin 2',null)`);
    const secondAdminMembership = (
      await asUser(
        admin,
        `select id from os_memberships where user_id='${unbound}' and role='admin'`,
      )
    ).rows[0].id;
    await assert.rejects(
      asUser(
        admin,
        `select os_save_membership('${secondAdminMembership}','${unbound}',null,'gestor',true,'Admin 2')`,
      ),
    );
    await asUser(
      admin,
      `select os_reclassify_admin('${secondAdminMembership}',null,'gestor',true,'Gestor 2')`,
    );
    await asUser(
      admin,
      `select os_grant_admin('${unbound}','Admin 2','${secondAdminMembership}')`,
    );
    const replacementAdminMembership = (
      await asUser(
        admin,
        `select id from os_memberships where user_id='${unbound}' and role='admin' and active`,
      )
    ).rows[0].id;
    await asUser(
      admin,
      `select os_revoke_admin('${replacementAdminMembership}')`,
    );
    const primaryAdminMembership = (
      await asUser(
        admin,
        `select id from os_memberships where user_id='${admin}' and role='admin' and active`,
      )
    ).rows[0].id;
    await assert.rejects(
      asUser(admin, `select os_revoke_admin('${primaryAdminMembership}')`),
    );
    await assert.rejects(
      asUser(
        tech,
        `update os_orders set title='Alterada' where id='${orderA}' returning id`,
      ),
    );
    assert.deepEqual(
      (
        await asUser(
          admin,
          `select next_status,operation from os_order_available_actions('${orderA}')`,
        )
      ).rows,
      [
        { next_status: "Em análise", operation: "advance" },
        { next_status: "Cancelada", operation: "cancel" },
      ],
    );
    await asUser(tech, `select os_change_status('${orderA}','Em análise','')`);
    await asUser(
      admin,
      `select os_assign_order('${orderA}','${unitA}',null,'${owner}','${cat}')`,
    );
    await assert.rejects(
      asUser(admin, `select os_change_status('${orderA}','Em execução','')`),
    );
    await asUser(
      admin,
      `select os_assign_order('${orderA}','${unitA}','${tech}','${owner}','${cat}')`,
    );
    await asUser(tech, `select os_change_status('${orderA}','Em execução','')`);
    await assert.rejects(
      asUser(tech, `select os_complete_order('${orderB}','Finalizada')`),
    );
    await assert.rejects(
      asUser(manager, `select os_complete_order('${orderA}','Finalizada')`),
    );
    await assert.rejects(
      asUser(owner, `select os_complete_order('${orderA}','Finalizada')`),
    );
    await assert.rejects(
      asUser(admin, `select os_change_status('${orderA}','INVÁLIDO','')`),
    );
    await assert.rejects(
      asUser(admin, `select os_change_status('${orderA}','Aberta','')`),
    );
    await assert.rejects(
      asUser(
        admin,
        `select os_change_status('${orderA}','Concluída','Finalizada')`,
      ),
    );
    await assert.rejects(
      asUser(admin, `select os_complete_order('${orderA}','')`),
    );
    await assert.rejects(
      asUser(admin, `select os_cancel_order('${orderB}','')`),
    );
    await assert.rejects(
      asUser(
        admin,
        `select os_change_status('${orderB}','Cancelada','Duplicada')`,
      ),
    );
    await asUser(
      admin,
      `select os_cancel_order('${orderB}','Solicitação duplicada')`,
    );
    await assert.rejects(
      asUser(admin, `select os_change_status('${orderB}','Aberta','Revisão')`),
    );
    await assert.rejects(
      asUser(admin, `select os_reopen_order('${orderB}','')`),
    );
    await asUser(
      admin,
      `select os_reopen_order('${orderB}','Cancelamento revisto')`,
    );
    assert.deepEqual(
      (
        await asUser(
          admin,
          `select status,cancelled_at,reopened_at is not null as reopened from os_orders where id='${orderB}'`,
        )
      ).rows,
      [{ status: "Aberta", cancelled_at: null, reopened: true }],
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
    await asUser(
      manager,
      `insert into os_messages(order_id,body) values('${orderA}','Mensagem do gestor')`,
    );
    await assert.rejects(
      asUser(
        unbound,
        `insert into os_messages(order_id,body) values('${orderA}','Mensagem')`,
      ),
    );
    assert.equal(
      (await asUser(owner, "select id from os_audit")).rows.length,
      0,
    );
    assert.ok((await asUser(admin, "select id from os_audit")).rows.length > 0);
    const attachment = "00000000-0000-4000-a000-000000000099";
    const attachmentSha = "a".repeat(64);
    const attachmentId = (value) =>
      `00000000-0000-4000-a000-${String(value).padStart(12, "0")}`;
    const attachmentPolicy = (
      await asUser(owner, "select * from os_attachment_policy()")
    ).rows[0];
    assert.equal(Number(attachmentPolicy.max_file_bytes), 3145728);
    assert.equal(Number(attachmentPolicy.max_attachments_per_order), 20);
    await assert.rejects(
      asUser(
        owner,
        `insert into os_attachments(id,order_id,name,path,mime_type,size_bytes) values('${attachment}','${orderA}','a.pdf','${orderA}/${attachment}','application/pdf',10)`,
      ),
    );
    await asUser(
      owner,
      `select os_begin_attachment_upload(
        '${orderA}','${attachment}','a.pdf','application/pdf',10,'${attachmentSha}'
      )`,
    );
    assert.equal(
      (await asUser(owner, "select id from os_attachments")).rows.length,
      0,
    );
    await assert.rejects(
      asUser(
        other,
        `insert into storage.objects(bucket_id,name,metadata) values(
          'os-attachments','${orderA}/${attachment}','{"size":10}'
        )`,
      ),
    );
    await assert.rejects(
      asUser(
        owner,
        `insert into storage.objects(bucket_id,name,metadata) values(
          'os-attachments','${orderB}/${attachment}','{"size":10}'
        )`,
      ),
    );
    await asUser(
      owner,
      `insert into storage.objects(bucket_id,name,metadata) values(
        'os-attachments','${orderA}/${attachment}','{"size":10}'
      )`,
    );
    assert.equal(
      (
        await asUser(
          owner,
          `select os_complete_attachment_upload('${attachment}') as status`,
        )
      ).rows[0].status,
      "ready",
    );
    assert.equal(
      (await asUser(other, "select id from storage.objects")).rows.length,
      0,
    );
    assert.equal(
      (await asUser(owner, "select id from storage.objects")).rows.length,
      1,
    );

    const ownerPending = [200, 201, 202, 203].map(attachmentId);
    for (const pending of ownerPending) {
      await asUser(
        owner,
        `select os_begin_attachment_upload(
          '${orderA}','${pending}','limite.pdf','application/pdf',3145728,'${attachmentSha}'
        )`,
      );
    }
    await assert.rejects(
      asUser(
        owner,
        `select os_begin_attachment_upload(
          '${orderA}','${attachmentId(204)}','excedente.pdf','application/pdf',3145728,'${attachmentSha}'
        )`,
      ),
    );
    const adminBytes = [300, 301, 302, 303, 304].map(attachmentId);
    for (const pending of adminBytes) {
      await asUser(
        admin,
        `select os_begin_attachment_upload(
          '${orderA}','${pending}','volume.pdf','application/pdf',3145728,'${attachmentSha}'
        )`,
      );
    }
    await assert.rejects(
      asUser(
        tech,
        `select os_begin_attachment_upload(
          '${orderA}','${attachmentId(305)}','total.pdf','application/pdf',3145728,'${attachmentSha}'
        )`,
      ),
    );
    for (const pending of ownerPending) {
      assert.equal(
        (
          await asUser(
            owner,
            `select os_abort_attachment_upload('${pending}') as result`,
          )
        ).rows[0].result,
        "metadata_removed",
      );
    }
    for (const pending of adminBytes) {
      await asUser(admin, `select os_abort_attachment_upload('${pending}')`);
    }

    const adminPending = Array.from({ length: 19 }, (_, index) =>
      attachmentId(210 + index),
    );
    for (const pending of adminPending) {
      await asUser(
        admin,
        `select os_begin_attachment_upload(
          '${orderA}','${pending}','contagem.txt','text/plain',1,'${attachmentSha}'
        )`,
      );
    }
    await assert.rejects(
      asUser(
        admin,
        `select os_begin_attachment_upload(
          '${orderA}','${attachmentId(229)}','excedente.txt','text/plain',1,'${attachmentSha}'
        )`,
      ),
    );
    await asUser(
      admin,
      `insert into storage.objects(bucket_id,name,metadata) values(
        'os-attachments','${orderA}/${adminPending[0]}','{"size":1}'
      )`,
    );
    assert.equal(
      (
        await asUser(
          admin,
          `select os_abort_attachment_upload('${adminPending[0]}') as result`,
        )
      ).rows[0].result,
      "requires_reconciliation",
    );
    await assert.rejects(
      asUser(owner, "select * from os_attachment_reconciliation()"),
    );
    assert.ok(
      (
        await asUser(
          admin,
          `select issue from os_attachment_reconciliation()
           where attachment_id='${adminPending[0]}'`,
        )
      ).rows.some((row) => row.issue === "upload_not_finalized"),
    );
    assert.equal(
      (
        await asUser(
          admin,
          `select os_reconcile_attachment('${adminPending[0]}') as result`,
        )
      ).rows[0].result,
      "ready",
    );
    assert.ok(
      (
        await asUser(
          admin,
          `select issue from os_attachment_reconciliation()
           where attachment_id='${adminPending[1]}'`,
        )
      ).rows.some((row) => row.issue === "metadata_without_object"),
    );
    await asUser(
      admin,
      `insert into storage.objects(bucket_id,name,metadata) values(
        'os-attachments','${orderA}/${adminPending[1]}','{"size":2}'
      )`,
    );
    assert.equal(
      (
        await asUser(
          admin,
          `select os_reconcile_attachment('${adminPending[1]}') as result`,
        )
      ).rows[0].result,
      "quarantined",
    );
    const orphanPath = `${orderA}/${attachmentId(299)}`;
    await db.exec(
      "reset role; select set_config('request.jwt.claim.sub','',false);",
    );
    await db.query(
      `insert into storage.objects(bucket_id,name,metadata) values(
        'os-attachments','${orphanPath}','{"size":1}'
      )`,
    );
    assert.ok(
      (
        await asUser(
          admin,
          `select issue from os_attachment_reconciliation() where path='${orphanPath}'`,
        )
      ).rows.some((row) => row.issue === "object_without_metadata"),
    );
    await asUser(
      admin,
      `select os_complete_order('${orderA}','Atendimento validado')`,
    );
    assert.deepEqual(
      (
        await asUser(
          admin,
          `select status,resolution,completed_at is not null as completed from os_orders where id='${orderA}'`,
        )
      ).rows,
      [
        {
          status: "Concluída",
          resolution: "Atendimento validado",
          completed: true,
        },
      ],
    );
    await assert.rejects(
      asUser(
        owner,
        `insert into os_messages(order_id,body) values('${orderA}','Após encerramento')`,
      ),
    );
    assert.equal(
      (
        await asUser(
          tech,
          `select id from os_order_events where order_id='${orderA}'`,
        )
      ).rows.length,
      4,
    );
    await assert.rejects(
      asUser(
        admin,
        `update os_orders set title='Alteração direta' where id='${orderA}'`,
      ),
    );
    await asUser(
      admin,
      `select os_save_membership(
        (select id from os_memberships where user_id='${owner}' and role='solicitante'),
        '${owner}','${unitA}','solicitante',false,'Teste'
      )`,
    );
    assert.deepEqual(await visible(owner), []);
    await assert.rejects(
      asUser(
        admin,
        `update os_memberships set active=false where user_id='${admin}'`,
      ),
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(db.query("select id from os_orders"));
    await assert.rejects(db.query("select os_change_status(null,'Aberta','')"));
    await db.exec("reset role;");
    const unsecured = await db.query(
      "select tablename from pg_tables where schemaname='public' and tablename like 'os_%' and not rowsecurity",
    );
    assert.equal(unsecured.rows.length, 0);
    // Executa a conversão real no schema, incluindo reexecução sem sobrescrita.
    await db.exec("select set_config('request.jwt.claim.sub','',false);");
    await assert.rejects(
      db.query(
        `update os_memberships set active=false
         where user_id='${admin}' and role='admin'`,
      ),
    );
    await assert.rejects(
      db.query(
        `insert into os_orders(
          id,unit_id,opened_by,responsible_id,category_id,title,status
        ) values(
          '00000000-0000-4000-a000-000000000102','${unitA}','${owner}',
          '${tech}','${cat}','Conclusão inválida','Concluída'
        )`,
      ),
    );
    await assert.rejects(
      db.query(
        `insert into os_orders(
          id,unit_id,opened_by,responsible_id,category_id,title,status
        ) values(
          '00000000-0000-4000-a000-000000000106','${unitA}','${owner}',
          '${owner}','${cat}','Responsável sem vínculo','Em execução'
        )`,
      ),
    );
    await assert.rejects(
      db.query(
        `insert into os_orders(id,title,status) values(
          '00000000-0000-4000-a000-000000000103','Sem conciliação','Aberta'
        )`,
      ),
    );
    await assert.rejects(
      db.query(
        `insert into os_orders(
          id,unit_id,opened_by,category_id,title,status
        ) values(
          '00000000-0000-4000-a000-000000000104','${unitA}','${owner}',
          '${cat}','Sem responsável','Em execução'
        )`,
      ),
    );
    await assert.rejects(
      db.query(
        `insert into os_orders(
          id,unit_id,opened_by,category_id,title,status,cancelled_at
        ) values(
          '00000000-0000-4000-a000-000000000105','${unitA}','${owner}',
          '${cat}','Sem justificativa','Cancelada',now()
        )`,
      ),
    );
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
        ["os_import_records", imported.original, "source,source_id,payload"],
        [
          "os_orders",
          imported.orders,
          "id,legacy_id,import_source,import_source_id,unit_id,opened_by,responsible_id,category_id,title,status,details,opened_at,active",
        ],
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
      (
        await db.query(
          "select id from os_orders where legacy_id is not null and import_source='seed/ABERTURA_OS' and import_source_id=legacy_id",
        )
      ).rows.length,
      5,
    );
    assert.equal(
      (
        await db.query(
          "select id from os_orders where legacy_id is not null and status='A conferir' and opened_by is null and category_id is null",
        )
      ).rows.length,
      1,
    );
    const importedOrder = imported.orders[0].id;
    assert.equal(
      (
        await asUser(
          admin,
          `select * from os_order_available_actions('${importedOrder}')`,
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      asUser(admin, `select os_change_status('${importedOrder}','Aberta','')`),
    );
    assert.equal(
      (await db.query("select id from os_catalogs")).rows.length,
      538,
    );
    const archived = await db.query(
      "select payload from os_import_records where source='seed/ABERTURA_OS' order by source_id",
    );
    assert.equal(archived.rows.length, 5);

    const backfillTriage = "00000000-0000-4000-a000-000000000120";
    const backfillWaiting = "00000000-0000-4000-a000-000000000121";
    await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);");
    await db.query(
      `insert into os_orders(
        id,legacy_id,unit_id,opened_by,responsible_id,category_id,
        title,status,opened_at
      ) values
      ('${backfillTriage}','BF-TRIAGE','${unitA}','${admin}','${tech}','${cat}',
       'Backfill triagem','Em análise','2024-05-10T12:00:00Z'),
      ('${backfillWaiting}','BF-WAIT','${unitA}','${admin}','${tech}','${cat}',
       'Backfill espera','Aguardando material','2023-06-11T12:00:00Z')`,
    );
    await db.exec(orderFlowPreflight);
    await db.exec(orderFlowBackfill);
    assert.deepEqual(
      (
        await db.query(
          `select id,status,waiting_reason,protocol_year,
             protocol_code = protocol::text as code_preserves_protocol,legacy_id
           from os_orders
           where id in ('${backfillTriage}','${backfillWaiting}')
           order by id`,
        )
      ).rows,
      [
        {
          id: backfillTriage,
          status: "Em triagem",
          waiting_reason: null,
          protocol_year: 2024,
          code_preserves_protocol: true,
          legacy_id: "BF-TRIAGE",
        },
        {
          id: backfillWaiting,
          status: "Aguardando informação",
          waiting_reason: "material",
          protocol_year: 2023,
          code_preserves_protocol: true,
          legacy_id: "BF-WAIT",
        },
      ],
    );
    const firstBackfillEvents = Number(
      (
        await db.query(
          "select count(*)::integer as count from os_order_events where event_type='workflow_backfill'",
        )
      ).rows[0].count,
    );
    const firstBackfillExceptions = Number(
      (
        await db.query(
          "select count(*)::integer as count from os_audit where entity='os_order_flow_backfill'",
        )
      ).rows[0].count,
    );
    await db.exec(orderFlowBackfill);
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*)::integer as count from os_order_events where event_type='workflow_backfill'",
          )
        ).rows[0].count,
      ),
      firstBackfillEvents,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*)::integer as count from os_audit where entity='os_order_flow_backfill'",
          )
        ).rows[0].count,
      ),
      firstBackfillExceptions,
    );
    await db.exec(orderFlowValidation);

    await db.exec("reset role");
    await db.exec(relationalRollback);
    const restored = await db.query(
      `select details ->> 'route' as route from os_orders where id='${orderA}'`,
    );
    assert.equal(restored.rows[0].route, routeUsed);
    const restoredImport = await db.query(
      `select details ->> '_import_source' as source
       from os_orders where id='${importedOrder}'`,
    );
    assert.equal(restoredImport.rows[0].source, "seed/ABERTURA_OS");
    await assert.rejects(db.query("select route_id from os_orders limit 1"));
  } finally {
    await db.close();
  }
});
