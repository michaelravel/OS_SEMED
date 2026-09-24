import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrations = await Promise.all(
  (await fs.readdir(migrationsDirectory))
    .filter(
      (file) =>
        file.endsWith(".sql") && !file.endsWith("_performance_indexes.sql"),
    )
    .sort()
    .map((file) => fs.readFile(new URL(file, migrationsDirectory), "utf8")),
);

test("RLS do novo fluxo separa origem, execução, autoria e dados internos", async () => {
  const db = new PGlite();
  const id = (value) =>
    `20000000-0000-4000-a000-${String(value).padStart(12, "0")}`;
  const users = {
    admin: id(1),
    requester: id(2),
    originManager: id(3),
    destinationManager: id(4),
    assigned: id(5),
    unassigned: id(6),
    outsider: id(7),
  };
  const units = { origin: id(20), destination: id(21), other: id(22) };
  const category = id(30);
  const publicAttachment = id(40);
  const internalAttachment = id(41);

  const asUser = async (user, sql) => {
    await db.exec(
      `reset role; set role authenticated;
       select set_config('request.jwt.claim.sub','${user}',false);`,
    );
    try {
      return await db.query(sql);
    } finally {
      await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);");
    }
  };
  const asAnon = async (sql) => {
    await db.exec("reset role; set role anon;");
    try {
      return await db.query(sql);
    } finally {
      await db.exec("reset role;");
    }
  };
  const countAs = async (user, table, where = "true") =>
    Number(
      (await asUser(user, `select count(*)::int as total from ${table} where ${where}`))
        .rows[0].total,
    );

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create schema storage;
      create table storage.buckets(
        id text primary key,name text,public boolean,file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects(
        id uuid default gen_random_uuid(),bucket_id text,name text,
        metadata jsonb not null default '{}',created_at timestamptz not null default now()
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert on storage.objects to authenticated;
    `);
    await db.exec(migrations.join("\n"));

    await db.exec(`
      insert into auth.users(id) values
        ('${users.admin}'),('${users.requester}'),('${users.originManager}'),
        ('${users.destinationManager}'),('${users.assigned}'),
        ('${users.unassigned}'),('${users.outsider}');
      insert into os_profiles(id,name) select id,'Usuário de teste' from auth.users;
      insert into os_units(id,name) values
        ('${units.origin}','Origem'),('${units.destination}','Executora'),
        ('${units.other}','Outra unidade');
      insert into os_catalogs(id,legacy_id,kind,name)
        values('${category}','CAT-RLS-FLOW','logistics','Categoria');
      insert into os_memberships(user_id,unit_id,role) values
        ('${users.admin}',null,'admin'),
        ('${users.requester}','${units.origin}','solicitante'),
        ('${users.originManager}','${units.origin}','gestor'),
        ('${users.destinationManager}','${units.destination}','gestor'),
        ('${users.assigned}','${units.destination}','responsavel'),
        ('${users.unassigned}','${units.destination}','responsavel'),
        ('${users.outsider}','${units.other}','solicitante');
    `);

    const opened = await asUser(
      users.requester,
      `select os_open_order(
        'OS para matriz RLS','${units.origin}','${category}','Normal','{}',
        null,null,null
      ) as id`,
    );
    const order = opened.rows[0].id;
    const unrelatedOrder = (
      await asUser(
        users.outsider,
        `select os_open_order(
          'OS de outra unidade','${units.other}','${category}','Normal','{}',
          null,null,null
        ) as id`,
      )
    ).rows[0].id;
    const assignedMembership = (
      await db.query(
        `select id from os_memberships where user_id='${users.assigned}' and role='responsavel'`,
      )
    ).rows[0].id;

    await asUser(users.admin, `select os_start_triage('${order}',1)`);
    await asUser(
      users.admin,
      `select os_forward_order('${order}',2,'${units.destination}')`,
    );
    await asUser(
      users.admin,
      `select os_assign_order('${order}',3,'${assignedMembership}')`,
    );
    await asUser(users.assigned, `select os_start_service('${order}',4)`);
    const serviceEntry = (
      await asUser(
        users.assigned,
        `select os_add_service_entry(
          '${order}',5,'atendimento','Diagnóstico técnico interno',now()
        ) as id`,
      )
    ).rows[0].id;

    const publicPath = `${order}/${publicAttachment}`;
    const internalPath = `${order}/${internalAttachment}`;
    await db.exec(`
      insert into os_attachments(
        id,order_id,uploaded_by,name,path,mime_type,size_bytes,
        storage_status,inspection_status,service_entry_id
      ) values
        ('${publicAttachment}','${order}','${users.requester}','pedido.pdf',
         '${publicPath}','application/pdf',10,'ready','not_scanned',null),
        ('${internalAttachment}','${order}','${users.assigned}','laudo.pdf',
         '${internalPath}','application/pdf',10,'ready','not_scanned',${serviceEntry});
      insert into storage.objects(bucket_id,name,metadata) values
        ('os-attachments','${publicPath}','{"size":10}'),
        ('os-attachments','${internalPath}','{"size":10}');
      insert into os_order_events(
        order_id,actor,from_status,to_status,reason,event_type
      ) values(
        '${order}','${users.admin}','Em atendimento','Em atendimento',
        'Evento legado sem classificação',null
      );
    `);

    const internalActors = [
      users.admin,
      users.originManager,
      users.destinationManager,
      users.assigned,
    ];
    for (const user of internalActors) {
      assert.equal(await countAs(user, "os_orders", `id='${order}'`), 1);
      assert.equal(
        await countAs(user, "os_order_service_entries", `order_id='${order}'`),
        1,
      );
      assert.equal(
        await countAs(user, "os_attachments", `order_id='${order}'`),
        2,
      );
      assert.equal(
        await countAs(
          user,
          "storage.objects",
          `bucket_id='os-attachments' and name like '${order}/%'`,
        ),
        2,
      );
      assert.equal(
        (
          await asUser(
            user,
            `select os_order_can_collaborate('${order}') as allowed`,
          )
        ).rows[0].allowed,
        true,
      );
    }

    for (const user of [
      users.requester,
      users.originManager,
      users.destinationManager,
      users.assigned,
      users.unassigned,
    ]) {
      assert.equal(
        await countAs(user, "os_orders", `id='${unrelatedOrder}'`),
        0,
      );
    }
    assert.equal(
      await countAs(users.outsider, "os_orders", `id='${unrelatedOrder}'`),
      1,
    );
    assert.equal(
      await countAs(users.admin, "os_orders", `id='${unrelatedOrder}'`),
      1,
    );

    for (const user of [users.unassigned, users.outsider]) {
      assert.equal(await countAs(user, "os_orders", `id='${order}'`), 0);
      assert.equal(
        await countAs(user, "os_order_service_entries", `order_id='${order}'`),
        0,
      );
      assert.equal(
        await countAs(user, "os_attachments", `order_id='${order}'`),
        0,
      );
      assert.equal(
        (
          await asUser(
            user,
            `select os_order_can_collaborate('${order}') as allowed`,
          )
        ).rows[0].allowed,
        false,
      );
    }

    assert.equal(await countAs(users.requester, "os_orders", `id='${order}'`), 1);
    assert.equal(
      (
        await asUser(
          users.requester,
          `select os_order_can_collaborate('${order}') as allowed`,
        )
      ).rows[0].allowed,
      true,
    );
    assert.equal(
      await countAs(users.requester, "os_order_service_entries", `order_id='${order}'`),
      0,
    );
    assert.deepEqual(
      (
        await asUser(
          users.requester,
          `select id from os_attachments where order_id='${order}' order by id`,
        )
      ).rows.map((row) => row.id),
      [publicAttachment],
    );
    assert.deepEqual(
      (
        await asUser(
          users.requester,
          `select name from storage.objects
           where bucket_id='os-attachments' and name like '${order}/%' order by name`,
        )
      ).rows.map((row) => row.name),
      [publicPath],
    );
    assert.equal(
      await countAs(
        users.requester,
        "os_order_events",
        `order_id='${order}' and event_type='service_entry_added'`,
      ),
      0,
    );
    assert.equal(
      await countAs(
        users.requester,
        "os_order_events",
        `order_id='${order}' and event_type is null`,
      ),
      0,
    );
    assert.ok(
      (await countAs(users.requester, "os_order_events", `order_id='${order}'`)) > 0,
    );
    assert.equal(
      await countAs(
        users.originManager,
        "os_order_events",
        `order_id='${order}' and event_type='service_entry_added'`,
      ),
      1,
    );
    assert.equal(
      await countAs(
        users.originManager,
        "os_order_events",
        `order_id='${order}' and event_type is null`,
      ),
      1,
    );

    await asUser(
      users.destinationManager,
      `insert into os_messages(order_id,body) values('${order}','Coordenação da execução')`,
    );
    await assert.rejects(
      asUser(
        users.destinationManager,
        `update os_units set name='Origem alterada' where id='${units.origin}'`,
      ),
    );
    await assert.rejects(
      asUser(
        users.destinationManager,
        `select os_edit_order_controlled(
          '${order}',6,'Título indevido','Alta','','{}'
        )`,
      ),
    );
    await assert.rejects(
      asUser(
        users.unassigned,
        `select os_add_service_entry(
          '${order}',6,'atendimento','Tentativa sem atribuição',now()
        )`,
      ),
    );
    await assert.rejects(
      asUser(
        users.requester,
        `insert into os_messages(order_id,author_id,body)
         values('${order}','${users.admin}','Autoria falsificada')`,
      ),
    );
    await assert.rejects(
      asUser(
        users.assigned,
        `insert into os_order_service_entries(
          order_id,author_id,author_membership_id,entry_type,description,serviced_at
        ) values(
          '${order}','${users.admin}','${assignedMembership}',
          'atendimento','Autoria falsificada',now()
        )`,
      ),
    );
    assert.deepEqual(
      (
        await db.query(
          `select author_id,author_membership_id from os_order_service_entries
           where id=${serviceEntry}`,
        )
      ).rows,
      [{ author_id: users.assigned, author_membership_id: assignedMembership }],
    );

    await assert.rejects(
      asUser(
        users.admin,
        `update os_order_events set reason='alterado' where order_id='${order}'`,
      ),
    );
    await assert.rejects(
      asUser(users.admin, `delete from os_order_events where order_id='${order}'`),
    );
    await assert.rejects(asAnon("select id from os_orders"));
    await assert.rejects(asAnon("select id from os_order_events"));
    await assert.rejects(asAnon("select id from os_order_service_entries"));
    await assert.rejects(asAnon("select id from os_attachments"));
    await assert.rejects(
      asAnon(`select os_start_service('${order}',6)`),
    );
    await assert.rejects(
      asAnon(`select os_order_can_collaborate('${order}')`),
    );
  } finally {
    await db.close();
  }
});
