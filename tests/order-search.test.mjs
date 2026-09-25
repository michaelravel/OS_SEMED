import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  decodeOrderCursor,
  encodeOrderCursor,
  orderFilterUrlParams,
  parseOrderProtocol,
} from "../src/lib/order-search-core.ts";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrations = await Promise.all(
  (await fs.readdir(migrationsDirectory))
    .filter(
      (file) => file.endsWith(".sql") && !file.endsWith("_performance_indexes.sql"),
    )
    .sort()
    .map((file) => fs.readFile(new URL(file, migrationsDirectory), "utf8")),
);

test("normaliza protocolo, filtros e cursor persistente", () => {
  assert.deepEqual(parseOrderProtocol("OS-000042"), {
    protocol: 42,
    code: null,
    year: null,
  });
  assert.deepEqual(parseOrderProtocol("OS 000042/2026"), {
    protocol: null,
    code: "42",
    year: 2026,
  });
  assert.equal(parseOrderProtocol("protocolo livre"), null);

  const cursor = encodeOrderCursor({
    createdAt: "2026-09-25T12:00:00.000Z",
    id: "10000000-0000-4000-a000-000000000001",
  });
  assert.deepEqual(decodeOrderCursor(cursor), {
    createdAt: "2026-09-25T12:00:00.000Z",
    id: "10000000-0000-4000-a000-000000000001",
  });
  assert.equal(decodeOrderCursor("inválido"), null);

  const url = orderFilterUrlParams({
    q: "  ônibus%  ",
    protocol: "OS-000042",
    status: "Em triagem",
    priority: "Alta",
    category: "",
    origin: "",
    destination: "",
    requester: "",
    responsible: "",
    openedFrom: "2026-01-01",
    openedTo: "",
    completedFrom: "",
    completedTo: "",
    reopened: true,
    waiting: true,
  }).toString();
  for (const key of ["q=", "protocol=", "status=", "priority=", "opened_from=", "reopened=1", "waiting=1"])
    assert.ok(url.includes(key), `filtro ${key} deveria permanecer na URL`);
});

test("pesquisa aplica filtros, RLS e cursor estável sob novas inserções", async () => {
  const db = new PGlite();
  const id = (value) =>
    `30000000-0000-4000-a000-${String(value).padStart(12, "0")}`;
  const users = { admin: id(1), requester: id(2), other: id(3), tech: id(4) };
  const units = { origin: id(10), destination: id(11), other: id(12) };
  const categories = { first: id(20), second: id(21) };

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
  const literal = (value) => {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    return `'${String(value).replaceAll("'", "''")}'`;
  };
  const search = async (user, overrides = {}) => {
    const values = {
      search_text: null,
      target_protocol: null,
      target_protocol_code: null,
      target_protocol_year: null,
      target_status: null,
      target_priority: null,
      target_category: null,
      target_origin_unit: null,
      target_destination_unit: null,
      target_requester: null,
      target_responsible: null,
      opened_from: null,
      opened_until: null,
      completed_from: null,
      completed_until: null,
      only_reopened: false,
      only_waiting: false,
      cursor_created_at: null,
      cursor_id: null,
      cursor_direction: "next",
      page_size: 25,
      ...overrides,
    };
    return asUser(
      user,
      `select * from os_search_orders(${Object.values(values).map(literal).join(",")})`,
    );
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
        ('${users.admin}'),('${users.requester}'),('${users.other}'),('${users.tech}');
      insert into os_profiles(id,name) values
        ('${users.admin}','Administrador'),('${users.requester}','Solicitante A'),
        ('${users.other}','Solicitante B'),('${users.tech}','Técnico');
      insert into os_units(id,name) values
        ('${units.origin}','Origem'),('${units.destination}','Executora'),
        ('${units.other}','Outra');
      insert into os_catalogs(id,legacy_id,kind,name) values
        ('${categories.first}','SEARCH-1','logistics','Transporte'),
        ('${categories.second}','SEARCH-2','logistics','Manutenção');
      insert into os_memberships(user_id,unit_id,role) values
        ('${users.admin}',null,'admin'),
        ('${users.requester}','${units.origin}','solicitante'),
        ('${users.other}','${units.other}','solicitante'),
        ('${users.tech}','${units.destination}','responsavel');
    `);

    const definitions = [
      [users.requester, "Transporte escolar", categories.first, "Urgente"],
      [users.requester, "Manutenção do ônibus", categories.first, "Normal"],
      [users.requester, "Material didático", categories.first, "Alta"],
      [users.requester, "Visita técnica", categories.first, "Baixa"],
      [users.requester, "Transporte de merenda", categories.second, "Normal"],
      [users.other, "Ordem de outra unidade", categories.second, "Normal"],
    ];
    const orders = [];
    for (const [user, title, category, priority] of definitions) {
      const unit = user === users.other ? units.other : units.origin;
      const opened = await asUser(
        user,
        `select os_open_order(
          '${title}','${unit}','${category}','${priority}','{}',null,null,null
        ) as id`,
      );
      orders.push(opened.rows[0].id);
    }
    const techMembership = (
      await db.query(`select id from os_memberships where user_id='${users.tech}'`)
    ).rows[0].id;
    await db.exec(`
      update os_orders set created_at='2026-01-01T12:00:00Z',opened_at='2026-01-01T12:00:00Z',protocol_year=2026,protocol_code=protocol::text
        where id='${orders[0]}';
      update os_orders set created_at='2026-01-02T12:00:00Z',opened_at='2026-01-02T12:00:00Z',status='Em triagem',triaged_at='2026-01-02T13:00:00Z'
        where id='${orders[1]}';
      update os_orders set created_at='2026-01-03T12:00:00Z',opened_at='2026-01-03T12:00:00Z',status='Aguardando informação',resume_status='Em triagem',waiting_since='2026-01-03T13:00:00Z',waiting_reason='material',waiting_details='Aguardando item'
        where id='${orders[2]}';
      update os_orders set created_at='2026-01-04T12:00:00Z',opened_at='2026-01-04T12:00:00Z',status='Concluída',destination_unit_id='${units.destination}',responsible_id='${users.tech}',responsible_membership_id='${techMembership}',resolution='Concluída',status_reason='Concluída',completed_at='2026-01-10T12:00:00Z'
        where id='${orders[3]}';
      update os_orders set created_at='2026-01-05T12:00:00Z',opened_at='2026-01-05T12:00:00Z',status='Em triagem',triaged_at='2026-01-05T13:00:00Z',reopened_at='2026-01-06T12:00:00Z'
        where id='${orders[4]}';
      update os_orders set created_at='2026-01-06T12:00:00Z',opened_at='2026-01-06T12:00:00Z'
        where id='${orders[5]}';
    `);

    const protocol = (
      await db.query(`select protocol from os_orders where id='${orders[0]}'`)
    ).rows[0].protocol;
    assert.deepEqual(
      (await search(users.requester, { target_protocol: Number(protocol) })).rows.map((row) => row.id),
      [orders[0]],
    );
    assert.deepEqual(
      (await search(users.requester, {
        target_protocol_code: String(protocol),
        target_protocol_year: 2026,
      })).rows.map((row) => row.id),
      [orders[0]],
    );
    assert.deepEqual(
      (await search(users.requester, { search_text: "Transporte" })).rows.map((row) => row.id),
      [orders[4], orders[0]],
    );
    assert.deepEqual(
      (await search(users.requester, { target_status: "Aguardando informação" })).rows.map((row) => row.id),
      [orders[2]],
    );
    assert.deepEqual(
      (await search(users.requester, { target_priority: "Urgente" })).rows.map((row) => row.id),
      [orders[0]],
    );
    assert.deepEqual(
      (await search(users.requester, { target_category: categories.second })).rows.map((row) => row.id),
      [orders[4]],
    );
    assert.equal(
      (await search(users.requester, { target_origin_unit: units.origin })).rows.length,
      5,
    );
    assert.equal(
      (await search(users.requester, { target_requester: users.requester })).rows.length,
      5,
    );
    assert.deepEqual(
      (await search(users.requester, { target_destination_unit: units.destination })).rows.map((row) => row.id),
      [orders[3]],
    );
    assert.deepEqual(
      (await search(users.requester, { target_responsible: users.tech })).rows.map((row) => row.id),
      [orders[3]],
    );
    assert.deepEqual(
      (await search(users.requester, {
        opened_from: "2026-01-03T00:00:00Z",
        opened_until: "2026-01-05T00:00:00Z",
      })).rows.map((row) => row.id),
      [orders[3], orders[2]],
    );
    assert.deepEqual(
      (await search(users.requester, {
        completed_from: "2026-01-10T00:00:00Z",
        completed_until: "2026-01-11T00:00:00Z",
      })).rows.map((row) => row.id),
      [orders[3]],
    );
    assert.deepEqual(
      (await search(users.requester, { only_reopened: true })).rows.map((row) => row.id),
      [orders[4]],
    );
    assert.deepEqual(
      (await search(users.requester, { only_waiting: true })).rows.map((row) => row.id),
      [orders[2]],
    );

    const firstPage = (await search(users.requester, { page_size: 2 })).rows;
    assert.deepEqual(firstPage.map((row) => row.id), [orders[4], orders[3]]);
    const inserted = (
      await asUser(
        users.requester,
        `select os_open_order(
          'Nova ordem concorrente','${units.origin}','${categories.first}',
          'Normal','{}',null,null,null
        ) as id`,
      )
    ).rows[0].id;
    await db.exec(`update os_orders set created_at='2026-01-07T12:00:00Z',opened_at='2026-01-07T12:00:00Z' where id='${inserted}'`);
    const secondPage = (
      await search(users.requester, {
        page_size: 2,
        cursor_created_at: new Date(firstPage[1].created_at).toISOString(),
        cursor_id: firstPage[1].id,
      })
    ).rows;
    assert.deepEqual(secondPage.map((row) => row.id), [orders[2], orders[1]]);
    assert.ok(!secondPage.some((row) => firstPage.some((firstRow) => firstRow.id === row.id)));
    const previousPage = (
      await search(users.requester, {
        page_size: 2,
        cursor_created_at: new Date(secondPage[0].created_at).toISOString(),
        cursor_id: secondPage[0].id,
        cursor_direction: "previous",
      })
    ).rows;
    assert.deepEqual(previousPage.map((row) => row.id), [orders[4], orders[3]]);

    const requesterOptions = (
      await asUser(users.requester, "select * from os_order_filter_options()")
    ).rows;
    assert.ok(!requesterOptions.some((option) => option.option_name === "Solicitante B"));
    assert.ok(!requesterOptions.some((option) => option.option_name === "Técnico"));
    assert.ok(
      (await asUser(users.admin, "select * from os_order_filter_options()"))
        .rows.some((option) => option.option_name === "Técnico"),
    );
    assert.equal((await search(users.other)).rows.length, 1);
    await assert.rejects(asAnon("select * from os_order_filter_options()"));
    await assert.rejects(
      asAnon(`select * from os_search_orders(${Array(20).fill("null").concat("25").join(",")})`),
    );
  } finally {
    await db.close();
  }
});
