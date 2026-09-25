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

test("RBAC resolve capacidade atual sem ampliar o escopo da unidade", async () => {
  const db = new PGlite();
  const id = (value) =>
    `51000000-0000-4000-a000-${String(value).padStart(12, "0")}`;
  const users = {
    allowed: id(1),
    otherUnit: id(2),
    inactiveMembership: id(3),
    inactiveProfile: id(4),
    noProfile: id(5),
    noMembership: id(6),
  };
  const units = { first: id(20), other: id(21) };
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
  const permission = async (user, key) =>
    (await asUser(user, `select os_has_permission('${key}') as allowed`)).rows[0]
      .allowed;

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
        ('${users.allowed}'),('${users.otherUnit}'),
        ('${users.inactiveMembership}'),('${users.inactiveProfile}'),
        ('${users.noProfile}'),('${users.noMembership}');
      insert into os_profiles(id,name) values
        ('${users.allowed}','Permitido'),('${users.otherUnit}','Outra unidade'),
        ('${users.inactiveMembership}','Vínculo inativo'),
        ('${users.inactiveProfile}','Perfil inativo'),
        ('${users.noProfile}','Sem perfil'),('${users.noMembership}','Sem vínculo');
      insert into os_professionals(id,name,auth_user_id) values
        ('${users.allowed}','Permitido','${users.allowed}'),
        ('${users.otherUnit}','Outra unidade','${users.otherUnit}'),
        ('${users.inactiveMembership}','Vínculo inativo','${users.inactiveMembership}'),
        ('${users.inactiveProfile}','Perfil inativo','${users.inactiveProfile}'),
        ('${users.noProfile}','Sem perfil','${users.noProfile}');
      insert into os_units(id,name) values
        ('${units.first}','Unidade A'),('${units.other}','Unidade B');
      insert into os_catalogs(id,legacy_id,kind,name)
        values('${category}','CAT-RBAC','logistics','Categoria RBAC');
      insert into os_access_profiles(key,name,description,legacy_role)
        values('inactive_test','Perfil que será inativado','Teste','solicitante');
      insert into os_access_profile_permissions(access_profile_id,permission_id)
        select profile.id,permission.id
        from os_access_profiles profile cross join os_permissions permission
        where profile.key='inactive_test' and permission.key='orders.view';
      insert into os_memberships(user_id,professional_id,unit_id,role,active) values
        ('${users.allowed}','${users.allowed}','${units.first}','solicitante',true),
        ('${users.otherUnit}','${users.otherUnit}','${units.other}','solicitante',true),
        ('${users.inactiveMembership}','${users.inactiveMembership}','${units.first}','solicitante',false);
      insert into os_memberships(
        user_id,professional_id,unit_id,role,active,access_profile_id
      ) select '${users.inactiveProfile}','${users.inactiveProfile}',
        '${units.first}','solicitante',true,id
        from os_access_profiles where key='inactive_test';
      update os_access_profiles set active=false where key='inactive_test';
    `);

    assert.equal(await permission(users.allowed, "orders.view"), true);
    assert.equal(await permission(users.allowed, "orders.complete"), false);
    assert.equal(await permission(users.inactiveMembership, "orders.view"), false);
    assert.equal(await permission(users.inactiveProfile, "orders.view"), false);
    assert.equal(await permission(users.noProfile, "orders.view"), false);
    assert.equal(await permission(users.noMembership, "orders.view"), false);
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.query("select os_has_permission('orders.view')"),
      /permission denied/i,
    );
    await db.exec("reset role;");

    await assert.rejects(
      asUser(
        users.allowed,
        `select os_open_order(
          'Parâmetro de unidade falsificado','${units.other}','${category}',
          'Normal','{}',null,null,null
        )`,
      ),
      /Acesso negado|Unidade inválida/i,
    );
    await assert.rejects(
      asUser(
        users.allowed,
        `select os_save_unit(null,'Unidade indevida','','','',true)`,
      ),
      /Acesso negado/i,
    );

    const firstOrder = (
      await asUser(
        users.allowed,
        `select os_open_order(
          'OS da unidade A','${units.first}','${category}','Normal','{}',
          null,null,null
        ) as id`,
      )
    ).rows[0].id;
    await assert.rejects(
      asUser(
        users.allowed,
        `select os_complete_order('${firstOrder}',1,'Solução indevida')`,
      ),
      /Acesso negado/i,
    );
    await asUser(
      users.otherUnit,
      `select os_open_order(
        'OS da unidade B','${units.other}','${category}','Normal','{}',
        null,null,null
      )`,
    );

    assert.equal(
      Number(
        (
          await asUser(
            users.allowed,
            "select count(*)::int total from os_orders",
          )
        ).rows[0].total,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await asUser(
            users.otherUnit,
            `select count(*)::int total from os_orders where id='${firstOrder}'`,
          )
        ).rows[0].total,
      ),
      0,
    );

    assert.deepEqual(
      (
        await asUser(
          users.allowed,
          "select permission_key from os_current_permissions() order by permission_key",
        )
      ).rows.map((row) => row.permission_key),
      [
        "dashboard.view",
        "drivers.view",
        "logistics.view",
        "orders.create",
        "orders.view",
        "routes.view",
        "units.view",
        "vehicles.view",
      ],
    );

    await db.exec(`
      delete from os_access_profile_permissions assignment
      using os_access_profiles profile,os_permissions permission
      where assignment.access_profile_id=profile.id
        and assignment.permission_id=permission.id
        and profile.key='requester' and permission.key='orders.view';
    `);
    assert.equal(await permission(users.allowed, "orders.view"), false);
    assert.equal(
      Number(
        (
          await asUser(
            users.allowed,
            "select count(*)::int total from os_orders",
          )
        ).rows[0].total,
      ),
      0,
    );
    await assert.rejects(
      asUser(
        users.allowed,
        `insert into os_messages(order_id,author_id,body)
         values('${firstOrder}','${users.allowed}','Mensagem sem permissão')`,
      ),
      /row-level security|permission denied/i,
    );
    await assert.rejects(
      asUser(
        users.allowed,
        `select os_begin_attachment_upload(
          '${firstOrder}','${id(40)}','arquivo.pdf','application/pdf',10,
          '${"a".repeat(64)}'
        )`,
      ),
      /Acesso negado/i,
    );
  } finally {
    await db.close();
  }
});
