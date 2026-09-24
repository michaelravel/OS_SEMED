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

test("operações canônicas validam estado, autorização, versão e atomicidade", async () => {
  const db = new PGlite();
  const ids = {
    admin: "10000000-0000-4000-a000-000000000001",
    requester: "10000000-0000-4000-a000-000000000002",
    tech1: "10000000-0000-4000-a000-000000000003",
    tech2: "10000000-0000-4000-a000-000000000004",
    outsider: "10000000-0000-4000-a000-000000000005",
    unit: "10000000-0000-4000-a000-000000000006",
    category: "10000000-0000-4000-a000-000000000007",
    pending: "10000000-0000-4000-a000-000000000008",
    executionUnit: "10000000-0000-4000-a000-000000000009",
  };
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
        ('${ids.admin}'),('${ids.requester}'),('${ids.tech1}'),
        ('${ids.tech2}'),('${ids.outsider}');
      insert into os_profiles(id,name) select id,'Teste' from auth.users;
      insert into os_units(id,name) values
        ('${ids.unit}','Unidade solicitante'),
        ('${ids.executionUnit}','Unidade executora');
      insert into os_catalogs(id,legacy_id,kind,name)
        values('${ids.category}','CAT-TX','logistics','Categoria');
      insert into os_memberships(user_id,unit_id,role) values
        ('${ids.admin}',null,'admin'),
        ('${ids.requester}','${ids.unit}','solicitante'),
        ('${ids.tech1}','${ids.executionUnit}','responsavel'),
        ('${ids.tech2}','${ids.executionUnit}','responsavel'),
        ('${ids.outsider}','${ids.unit}','solicitante');
      insert into os_orders(id,title,status) values
        ('${ids.pending}','Pendente para conciliação','A conferir');
    `);

    await assert.rejects(
      asUser(
        ids.admin,
        `select os_start_triage('${ids.pending}',1)`,
      ),
    );
    await asUser(
      ids.admin,
      `select os_reconcile_order(
        '${ids.pending}',1,'${ids.unit}','${ids.requester}','${ids.category}'
      )`,
    );
    assert.deepEqual(
      (
        await db.query(
          `select status,version from os_orders where id='${ids.pending}'`,
        )
      ).rows,
      [{ status: "Em triagem", version: 2 }],
    );

    const opened = await asUser(
      ids.requester,
      `select os_open_order(
        'Fluxo transacional','${ids.unit}','${ids.category}','Normal','{}',
        null,null,null
      ) as id`,
    );
    const order = opened.rows[0].id;

    assert.deepEqual(
      (
        await asUser(
          ids.admin,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "TRIAGE" },
        { operation: "CANCEL" },
        { operation: "EDIT" },
      ],
    );
    assert.deepEqual(
      (
        await asUser(
          ids.requester,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [],
    );

    await db.exec(`
      create function public.reject_test_event() returns trigger language plpgsql as $$
      begin
        if new.event_type='triage_started' then raise exception 'Falha simulada'; end if;
        return new;
      end $$;
      create trigger reject_test_event before insert on os_order_events
      for each row execute function public.reject_test_event();
    `);
    await assert.rejects(
      asUser(ids.admin, `select os_start_triage('${order}',1)`),
    );
    assert.deepEqual(
      (await db.query(`select status,version from os_orders where id='${order}'`))
        .rows,
      [{ status: "Aberta", version: 1 }],
    );
    await db.exec(
      "drop trigger reject_test_event on os_order_events; drop function public.reject_test_event();",
    );

    await asUser(ids.admin, `select os_start_triage('${order}',1)`);
    assert.deepEqual(
      (
        await asUser(
          ids.admin,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "FORWARD" },
        { operation: "WAIT_INFORMATION" },
        { operation: "CANCEL" },
        { operation: "EDIT" },
      ],
    );
    await assert.rejects(
      asUser(ids.admin, `select os_forward_order('${order}',1,'${ids.executionUnit}')`),
    );
    await assert.rejects(
      asUser(ids.outsider, `select os_forward_order('${order}',2,'${ids.executionUnit}')`),
    );
    await asUser(
      ids.admin,
      `select os_forward_order('${order}',2,'${ids.executionUnit}')`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.admin,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "ASSIGN" },
        { operation: "WAIT_INFORMATION" },
        { operation: "CANCEL" },
        { operation: "EDIT" },
      ],
    );

    const memberships = await db.query(
      `select user_id,id from os_memberships
       where user_id in ('${ids.tech1}','${ids.tech2}')`,
    );
    const tech1Membership = memberships.rows.find(
      (row) => row.user_id === ids.tech1,
    ).id;
    const tech2Membership = memberships.rows.find(
      (row) => row.user_id === ids.tech2,
    ).id;
    await asUser(
      ids.admin,
      `select os_assign_order('${order}',3,'${tech1Membership}')`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech1,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "START_SERVICE" },
        { operation: "WAIT_INFORMATION" },
        { operation: "CANCEL" },
      ],
    );
    assert.deepEqual(
      (
        await asUser(
          ids.admin,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "REASSIGN" },
        { operation: "START_SERVICE" },
        { operation: "WAIT_INFORMATION" },
        { operation: "CANCEL" },
        { operation: "EDIT" },
      ],
    );
    assert.equal(
      (await asUser(ids.tech1, `select id from os_orders where id='${order}'`))
        .rows.length,
      1,
    );
    await asUser(
      ids.admin,
      `select os_reassign_order('${order}',4,'${tech2Membership}','Troca de escala')`,
    );
    await assert.rejects(
      asUser(ids.tech1, `select os_start_service('${order}',5)`),
    );
    await asUser(ids.tech2, `select os_start_service('${order}',5)`);
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "ADD_SERVICE_ENTRY" },
        { operation: "WAIT_INFORMATION" },
        { operation: "CANCEL" },
      ],
    );
    await assert.rejects(
      asUser(
        ids.tech2,
        `select os_complete_order('${order}',6,'Solução antes do registro')`,
      ),
    );
    assert.equal(
      (await db.query(`select version from os_orders where id='${order}'`)).rows[0]
        .version,
      6,
    );
    await asUser(
      ids.tech2,
      `select os_add_service_entry(
        '${order}',6,'atendimento','Diagnóstico e correção registrados',now()
      )`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "ADD_SERVICE_ENTRY" },
        { operation: "WAIT_INFORMATION" },
        { operation: "COMPLETE" },
        { operation: "CANCEL" },
      ],
    );
    await asUser(
      ids.tech2,
      `select os_wait_for_information(
        '${order}',7,'material','Aguardando material necessário'
      )`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [{ operation: "RESUME" }, { operation: "CANCEL" }],
    );
    assert.deepEqual(
      (
        await db.query(
          `select status,resume_status,waiting_reason,version
           from os_orders where id='${order}'`,
        )
      ).rows,
      [
        {
          status: "Aguardando informação",
          resume_status: "Em atendimento",
          waiting_reason: "material",
          version: 8,
        },
      ],
    );
    await assert.rejects(
      asUser(ids.tech2, `select os_resume_service('${order}',7)`),
    );
    await asUser(ids.tech2, `select os_resume_service('${order}',8)`);
    await asUser(
      ids.tech2,
      `select os_complete_order('${order}',9,'Equipamento normalizado')`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [{ operation: "REOPEN" }],
    );
    await assert.rejects(
      asUser(
        ids.outsider,
        `select os_reopen_order('${order}',10,'Nova ocorrência')`,
      ),
    );
    await asUser(
      ids.admin,
      `select os_reopen_order('${order}',10,'Nova ocorrência')`,
    );
    await assert.rejects(
      asUser(
        ids.admin,
        `select os_edit_order_controlled(
          '${order}',11,'Fluxo transacional','Alta','','{}'
        )`,
      ),
    );
    await asUser(
      ids.admin,
      `select os_edit_order_controlled(
        '${order}',11,'Fluxo transacional revisado','Alta','Impacto confirmado','{}'
      )`,
    );
    await asUser(
      ids.admin,
      `select os_cancel_order('${order}',12,'Solicitação substituída')`,
    );
    await assert.rejects(
      asUser(
        ids.admin,
        `select os_cancel_order('${order}',13,'Cancelamento repetido')`,
      ),
    );

    assert.deepEqual(
      (
        await db.query(
          `select status,version,legacy_id from os_orders where id='${order}'`,
        )
      ).rows,
      [{ status: "Cancelada", version: 13, legacy_id: null }],
    );
    assert.equal(
      Number(
        (
          await db.query(
            `select count(*)::integer as count from os_order_events
             where order_id='${order}' and operation is not null`,
          )
        ).rows[0].count,
      ),
      13,
    );
    await assert.rejects(
      db.query(
        `update os_order_events set reason='alterado' where order_id='${order}'`,
      ),
    );
  } finally {
    await db.close();
  }
});
