import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationFiles = (await fs.readdir(migrationsDirectory))
  .filter(
    (file) => file.endsWith(".sql") && !file.endsWith("_performance_indexes.sql"),
  )
  .sort();
const rbacFile = "202609250004_rbac_profiles_permissions.sql";
const previousMigrations = await Promise.all(
  migrationFiles
    .filter((file) => file < rbacFile)
    .map((file) => fs.readFile(new URL(file, migrationsDirectory), "utf8")),
);
const rbacMigration = await fs.readFile(
  new URL(rbacFile, migrationsDirectory),
  "utf8",
);

test("RBAC cria perfis configuráveis, permissões e compatibilidade com vínculos", async () => {
  const db = new PGlite();
  const admin = "b1000000-0000-4000-a000-000000000001";
  const requester = "b1000000-0000-4000-a000-000000000002";
  const pendingManager = "b1000000-0000-4000-a000-000000000003";
  const unit = "b1000000-0000-4000-a000-000000000010";
  const asUser = async (user, sql) => {
    await db.exec(
      `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`,
    );
    try {
      return await db.query(sql);
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false);",
      );
    }
  };

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb not null default '{}',created_at timestamptz not null default now());
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert on storage.objects to authenticated;
    `);
    await db.exec(previousMigrations.join("\n"));
    await db.exec(`
      insert into auth.users(id) values('${admin}'),('${requester}');
      insert into os_profiles(id,name) values('${admin}','Admin'),('${requester}','Solicitante');
      insert into os_units(id,name) values('${unit}','Unidade');
      insert into os_memberships(user_id,unit_id,role) values
        ('${admin}',null,'admin'),('${requester}','${unit}','solicitante');
    `);

    await db.exec(rbacMigration);

    assert.equal(
      Number(
        (await db.query("select count(*)::int total from os_access_profiles")).rows[0]
          .total,
      ),
      4,
    );
    assert.equal(
      Number(
        (await db.query("select count(*)::int total from os_permissions")).rows[0]
          .total,
      ),
      35,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*)::int total from os_memberships where access_profile_id is not null",
          )
        ).rows[0].total,
      ),
      2,
    );

    const requesterProfile = (
      await db.query(
        `select p.key from os_memberships m join os_access_profiles p on p.id=m.access_profile_id where m.user_id='${requester}'`,
      )
    ).rows[0];
    assert.equal(requesterProfile.key, "requester");

    assert.deepEqual(
      (
        await db.query("select key from os_permissions order by key")
      ).rows.map((row) => row.key),
      [
        "audit.view",
        "dashboard.view",
        "drivers.create",
        "drivers.update",
        "drivers.view",
        "logistics.create",
        "logistics.update",
        "logistics.view",
        "orders.assign",
        "orders.attend",
        "orders.cancel",
        "orders.complete",
        "orders.create",
        "orders.forward",
        "orders.reassign",
        "orders.reopen",
        "orders.resume",
        "orders.triage",
        "orders.update",
        "orders.view",
        "orders.wait_information",
        "professionals.create",
        "professionals.delete",
        "professionals.manage",
        "professionals.update",
        "professionals.view",
        "routes.create",
        "routes.update",
        "routes.view",
        "units.create",
        "units.update",
        "units.view",
        "vehicles.create",
        "vehicles.update",
        "vehicles.view",
      ],
    );

    await db.query(
      `insert into os_professionals(id,name,active) values('${pendingManager}','Gestor pendente',true)`,
    );
    await db.query(
      `insert into os_memberships(professional_id,user_id,unit_id,role,active)
       values('${pendingManager}',null,null,'gestor',false)`,
    );
    assert.equal(
      (
        await db.query(
          "select p.key from os_memberships m join os_access_profiles p on p.id=m.access_profile_id where m.user_id is null order by m.id desc limit 1",
        )
      ).rows[0].key,
      "manager",
    );

    const customProfile = (
      await db.query(
        `insert into os_access_profiles(key,name,description,legacy_role)
         values('school_manager','Gestor escolar','Perfil configurável de teste','gestor')
         returning id`,
      )
    ).rows[0].id;
    await db.query(
      `insert into os_access_profile_permissions(access_profile_id,permission_id)
       select '${customProfile}',id from os_permissions where key in ('orders.view','professionals.update')`,
    );
    await db.query(
      `update os_memberships set access_profile_id='${customProfile}'
       where professional_id='${pendingManager}'`,
    );
    assert.deepEqual(
      (
        await db.query(
          `select m.role,p.key
           from os_memberships m
           join os_access_profiles p on p.id=m.access_profile_id
           where m.professional_id='${pendingManager}'`,
        )
      ).rows[0],
      { role: "gestor", key: "school_manager" },
    );
    assert.deepEqual(
      (
        await db.query(
          `select permission.key
           from os_access_profile_permissions assignment
           join os_permissions permission on permission.id=assignment.permission_id
           where assignment.access_profile_id='${customProfile}'
           order by permission.key`,
        )
      ).rows.map((row) => row.key),
      ["orders.view", "professionals.update"],
    );

    await db.query(
      `update os_memberships set role='responsavel' where user_id='${requester}'`,
    );
    assert.equal(
      (
        await db.query(
          `select m.role,p.key from os_memberships m join os_access_profiles p on p.id=m.access_profile_id where m.user_id='${requester}'`,
        )
      ).rows[0].key,
      "responsible",
    );

    await assert.rejects(
      db.query(
        "insert into os_permissions(key,module,action,description) values('Orders.Invalid','orders','invalid','Inválida')",
      ),
      /constraint|violates/i,
    );

    assert.equal(
      Number(
        (await asUser(requester, "select count(*)::int total from os_permissions"))
          .rows[0].total,
      ),
      0,
    );
    assert.equal(
      Number(
        (await asUser(admin, "select count(*)::int total from os_permissions"))
          .rows[0].total,
      ),
      35,
    );
    await assert.rejects(
      asUser(
        admin,
        "update os_access_profiles set name='Alteração direta' where key='manager'",
      ),
      /permission denied|row-level security/i,
    );
  } finally {
    await db.close();
  }
});
