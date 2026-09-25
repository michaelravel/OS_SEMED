import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { visibleNavigationItems } from "../src/lib/navigation.ts";

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

test("matriz final cobre os cinco perfis reais e reage sem cache", async () => {
  const db = new PGlite();
  const id = (value) =>
    `71000000-0000-4000-a000-${String(value).padStart(12, "0")}`;
  const users = {
    admin: id(1),
    manager: id(2),
    responsible: id(3),
    requester: id(4),
    viewer: id(5),
  };
  const units = { origin: id(20), other: id(21) };
  const category = id(30);

  const asUser = async (user, sql) => {
    await db.exec(
      `reset role; set role authenticated;
       select set_config('request.jwt.claim.sub','${user}',false);`,
    );
    try {
      return await db.query(sql);
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false);",
      );
    }
  };
  const permissions = async (user) =>
    new Set(
      (
        await asUser(
          user,
          "select permission_key from os_current_permissions() order by permission_key",
        )
      ).rows.map((row) => row.permission_key),
    );

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(
        id uuid primary key,email text,raw_app_meta_data jsonb not null default '{}',
        email_confirmed_at timestamptz
      );
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
        ('${users.admin}'),('${users.manager}'),('${users.responsible}'),
        ('${users.requester}'),('${users.viewer}');
      insert into os_profiles(id,name) values
        ('${users.admin}','Administrador'),('${users.manager}','Gestor'),
        ('${users.responsible}','Responsável'),('${users.requester}','Solicitante'),
        ('${users.viewer}','Consulta');
      insert into os_professionals(id,name,auth_user_id) values
        ('${users.admin}','Administrador','${users.admin}'),
        ('${users.manager}','Gestor','${users.manager}'),
        ('${users.responsible}','Responsável','${users.responsible}'),
        ('${users.requester}','Solicitante','${users.requester}'),
        ('${users.viewer}','Consulta','${users.viewer}');
      insert into os_units(id,name) values
        ('${units.origin}','Origem'),('${units.other}','Outra unidade');
      insert into os_catalogs(id,legacy_id,kind,name)
        values('${category}','CAT-FINAL','logistics','Categoria');
      insert into os_memberships(user_id,professional_id,unit_id,role) values
        ('${users.admin}','${users.admin}',null,'admin'),
        ('${users.manager}','${users.manager}',null,'gestor'),
        ('${users.responsible}','${users.responsible}','${units.origin}','responsavel'),
        ('${users.requester}','${users.requester}','${units.origin}','solicitante');
      insert into os_memberships(
        user_id,professional_id,unit_id,role,access_profile_id
      ) select '${users.viewer}','${users.viewer}','${units.other}',
        'solicitante',id from os_access_profiles where key='viewer';
    `);

    const matrix = {
      admin: await permissions(users.admin),
      manager: await permissions(users.manager),
      responsible: await permissions(users.responsible),
      requester: await permissions(users.requester),
      viewer: await permissions(users.viewer),
    };
    assert.equal(matrix.admin.has("professionals.manage"), true);
    assert.equal(matrix.manager.has("orders.view"), true);
    assert.equal(matrix.manager.has("orders.create"), false);
    assert.equal(matrix.responsible.has("orders.complete"), true);
    assert.equal(matrix.responsible.has("orders.assign"), false);
    assert.equal(matrix.requester.has("orders.create"), true);
    assert.equal(matrix.requester.has("orders.complete"), false);
    assert.equal(matrix.viewer.has("orders.view"), true);
    assert.equal(matrix.viewer.has("orders.create"), false);

    const expectedNewOrderVisibility = {
      admin: true,
      manager: false,
      responsible: false,
      requester: true,
      viewer: false,
    };
    for (const [profile, profilePermissions] of Object.entries(matrix))
      assert.equal(
        profilePermissions.has("orders.create"),
        expectedNewOrderVisibility[profile],
        `visibilidade de Nova OS incorreta para ${profile}`,
      );

    const adminMenu = visibleNavigationItems(matrix.admin, true);
    const viewerMenu = visibleNavigationItems(matrix.viewer, false);
    assert.ok(adminMenu.some((item) => item.href === "/perfis"));
    assert.ok(adminMenu.some((item) => item.href === "/auditoria"));
    assert.equal(
      viewerMenu.some((item) => item.section === "administration"),
      false,
    );
    assert.ok(viewerMenu.some((item) => item.href === "/ordens"));
    for (const [profile, profilePermissions] of Object.entries(matrix)) {
      const menu = visibleNavigationItems(
        profilePermissions,
        profile === "admin",
      );
      assert.equal(
        menu.some((item) => item.section === "administration"),
        profile === "admin",
        `seção administrativa incorreta para ${profile}`,
      );
    }

    await assert.rejects(
      asUser(
        users.viewer,
        "select os_save_unit(null,'Indevida','','','',true)",
      ),
      /Acesso negado/i,
    );
    const order = (
      await asUser(
        users.requester,
        `select os_open_order(
          'OS de escopo','${units.origin}','${category}','Normal','{}',
          null,null,null
        ) as id`,
      )
    ).rows[0].id;
    assert.equal(
      Number(
        (
          await asUser(
            users.viewer,
            `select count(*)::int total from os_orders where id='${order}'`,
          )
        ).rows[0].total,
      ),
      0,
    );

    await db.exec(`
      delete from os_access_profile_permissions assignment
      using os_access_profiles profile,os_permissions permission
      where assignment.access_profile_id=profile.id
        and assignment.permission_id=permission.id
        and profile.key='viewer' and permission.key='orders.view';
    `);
    assert.equal((await permissions(users.viewer)).has("orders.view"), false);

    await db.exec(
      `update os_memberships set active=false where user_id='${users.manager}'`,
    );
    assert.equal((await permissions(users.manager)).size, 0);

    const adminMembership = (
      await db.query(
        `select id from os_memberships where user_id='${users.admin}'`,
      )
    ).rows[0].id;
    await assert.rejects(
      asUser(
        users.admin,
        `select os_deactivate_professional_membership('${adminMembership}')`,
      ),
      /último administrador ativo/i,
    );
  } finally {
    await db.close();
  }
});
