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

test("administração de perfis usa operações seguras e auditáveis", async () => {
  const db = new PGlite();
  const id = (value) =>
    `61000000-0000-4000-a000-${String(value).padStart(12, "0")}`;
  const admin = id(1);
  const requester = id(2);
  const unit = id(10);

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
      insert into auth.users(id) values('${admin}'),('${requester}');
      insert into os_profiles(id,name) values
        ('${admin}','Administrador'),('${requester}','Solicitante');
      insert into os_professionals(id,name,auth_user_id) values
        ('${admin}','Administrador','${admin}'),
        ('${requester}','Solicitante','${requester}');
      insert into os_units(id,name) values('${unit}','Unidade');
      insert into os_memberships(user_id,professional_id,unit_id,role) values
        ('${admin}','${admin}',null,'admin'),
        ('${requester}','${requester}','${unit}','solicitante');
    `);

    const profile = (
      await asUser(
        admin,
        `select os_save_access_profile(
          null,'Atendimento escolar','Perfil configurável',true,'responsavel'
        ) as id`,
      )
    ).rows[0].id;
    assert.match(
      (
        await db.query(
          `select key from os_access_profiles where id='${profile}'`,
        )
      ).rows[0].key,
      /^custom_[a-f0-9]{32}$/,
    );

    await asUser(
      admin,
      `select os_set_access_profile_permissions(
        '${profile}',array['orders.view','orders.attend']::text[]
      )`,
    );
    assert.deepEqual(
      (
        await db.query(
          `select permission.key
           from os_access_profile_permissions assignment
           join os_permissions permission on permission.id=assignment.permission_id
           where assignment.access_profile_id='${profile}'
           order by permission.key`,
        )
      ).rows.map((row) => row.key),
      ["orders.attend", "orders.view"],
    );
    const permissionAuditRow = (
      await db.query(
        `select actor,record_id,created_at,after_data from os_audit
         where entity='os_access_profile_permissions'
           and record_id='${profile}'
         order by id desc limit 1`,
      )
    ).rows[0];
    assert.equal(permissionAuditRow.actor, admin);
    assert.equal(permissionAuditRow.record_id, profile);
    assert.ok(permissionAuditRow.created_at);
    const permissionAudit = permissionAuditRow.after_data;
    assert.equal(permissionAudit.profile_name, "Atendimento escolar");
    assert.deepEqual(permissionAudit.added, ["orders.attend", "orders.view"]);
    assert.deepEqual(permissionAudit.removed, []);

    await asUser(
      admin,
      `select os_set_access_profile_permissions(
        '${profile}',array['orders.view']::text[]
      )`,
    );
    const removalAudit = (
      await db.query(
        `select after_data from os_audit
         where entity='os_access_profile_permissions'
           and record_id='${profile}'
         order by id desc limit 1`,
      )
    ).rows[0].after_data;
    assert.deepEqual(removalAudit.added, []);
    assert.deepEqual(removalAudit.removed, ["orders.attend"]);

    await assert.rejects(
      asUser(
        requester,
        `select os_save_access_profile(
          null,'Indevido','Sem autorização',true,'solicitante'
        )`,
      ),
      /Acesso negado/i,
    );
    await assert.rejects(
      asUser(
        admin,
        `insert into os_access_profiles(key,name,legacy_role)
         values('direct_write','Escrita direta','gestor')`,
      ),
      /permission denied|row-level security/i,
    );

    await db.query(
      `update os_memberships set access_profile_id='${profile}'
       where user_id='${requester}'`,
    );
    await assert.rejects(
      asUser(admin, `select os_delete_access_profile('${profile}')`),
      /em uso não pode ser excluído/i,
    );
    await assert.rejects(
      asUser(
        admin,
        `select os_save_access_profile(
          '${profile}','Atendimento escolar','Alterado',true,'gestor'
        )`,
      ),
      /em uso não pode mudar/i,
    );
    await asUser(
      admin,
      `select os_save_access_profile(
        '${profile}','Atendimento escolar','Desativado',false,'responsavel'
      )`,
    );
    assert.equal(
      (
        await asUser(
          requester,
          "select os_has_permission('orders.view') as allowed",
        )
      ).rows[0].allowed,
      false,
    );

    const adminProfile = (
      await db.query("select id from os_access_profiles where key='admin'")
    ).rows[0].id;
    await assert.rejects(
      asUser(
        admin,
        `select os_set_access_profile_permissions(
          '${adminProfile}',array['professionals.view']::text[]
        )`,
      ),
      /permissões essenciais/i,
    );
    await assert.rejects(
      asUser(
        admin,
        `select os_save_access_profile(
          '${adminProfile}','Administrador','Administração',false,'admin'
        )`,
      ),
      /deve permanecer ativo|não pode ser desativado/i,
    );
    await assert.rejects(
      db.query(
        `update os_memberships set active=false
         where user_id='${admin}' and role='admin'`,
      ),
      /último administrador ativo/i,
    );
    await assert.rejects(
      asUser(admin, `select os_delete_access_profile('${adminProfile}')`),
      /sistema não pode ser excluído/i,
    );

    const disposable = (
      await asUser(
        admin,
        `select os_save_access_profile(
          null,'Descartável','Sem vínculos',true,'gestor'
        ) as id`,
      )
    ).rows[0].id;
    await asUser(admin, `select os_delete_access_profile('${disposable}')`);
    assert.equal(
      Number(
        (
          await db.query(
            `select count(*)::int total from os_access_profiles where id='${disposable}'`,
          )
        ).rows[0].total,
      ),
      0,
    );
    assert.ok(
      Number(
        (
          await db.query(
            "select count(*)::int total from os_audit where entity in ('os_access_profiles','os_access_profile_permissions')",
          )
        ).rows[0].total,
      ) >= 4,
    );

    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.query(
        "select os_save_access_profile(null,'Anônimo','',true,'gestor')",
      ),
      /permission denied/i,
    );
  } finally {
    await db.close();
  }
});
