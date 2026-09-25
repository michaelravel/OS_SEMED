import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  allowedGoogleDomains,
  isAllowedGoogleEmail,
  normalizeInstitutionalEmail,
} from "../src/lib/professional-identity-core.ts";

const baseMigration = await fs.readFile(
  new URL("../supabase/migrations/202609230001_os_semed.sql", import.meta.url),
  "utf8",
);
const identityMigration = await fs.readFile(
  new URL("../supabase/migrations/202609250003_google_workspace_identity.sql", import.meta.url),
  "utf8",
);

test("normaliza e-mail institucional sem alterar a parte local", () => {
  assert.equal(normalizeInstitutionalEmail("  Pessoa.SEMED@EDU.EXEMPLO.BR "), "pessoa.semed@edu.exemplo.br");
});

test("aceita múltiplos domínios configurados sem duplicações", () => {
  assert.deepEqual(allowedGoogleDomains(" escola.gov.br, @semed.gov.br,ESCOLA.GOV.BR "), [
    "escola.gov.br",
    "semed.gov.br",
  ]);
  assert.equal(isAllowedGoogleEmail("a@semed.gov.br", ["escola.gov.br", "semed.gov.br"]), true);
});

test("recusa domínio não permitido e não aceita subdomínio implicitamente", () => {
  assert.equal(isAllowedGoogleEmail("a@gmail.com", ["semed.gov.br"]), false);
  assert.equal(isAllowedGoogleEmail("a@outra.semed.gov.br", ["semed.gov.br"]), false);
});

test("migration implementa os dez cenários obrigatórios de identidade", async (t) => {
  const db = new PGlite();
  const ids = Array.from({ length: 10 }, (_, index) =>
    `10000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`,
  );
  const [admin, legacy, first, unknown, inactive, other, takeover, noMembership, multi, deactivated] = ids;
  const unitA = "20000000-0000-4000-a000-000000000001";
  const unitB = "20000000-0000-4000-a000-000000000002";
  const google = JSON.stringify({ provider: "google", providers: ["google"] });
  const password = JSON.stringify({ provider: "email", providers: ["email"] });
  const asUser = async (user, sql) => {
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
    try { return await db.query(sql); }
    finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);"); }
  };
  const claim = async (user) => (await asUser(user, "select * from os_claim_professional_identity()" )).rows[0];

  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(
        id uuid primary key,email text,raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb not null default '{}',created_at timestamptz not null default now());
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;
    `);
    await db.exec(baseMigration);
    const users = [
      [admin, "admin@legacy.local", password], [legacy, "legacy@externo.local", password],
      [first, "first@one.edu", google], [unknown, "unknown@one.edu", google],
      [inactive, "inactive@one.edu", google], [other, "takeover@one.edu", google],
      [takeover, "takeover@one.edu", google], [noMembership, "nomember@one.edu", google],
      [multi, "multi@two.edu", google], [deactivated, "deactivated@one.edu", google],
    ];
    for (const [id, email, metadata] of users)
      await db.query("insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values($1,$2,$3,now())", [id,email,metadata]);
    await db.exec(`
      insert into os_profiles(id,name) values('${admin}','Admin legado'),('${legacy}','Usuário legado'),('${other}','Identidade existente');
      insert into os_units(id,name) values('${unitA}','Unidade A'),('${unitB}','Unidade B');
      insert into os_memberships(user_id,unit_id,role) values
        ('${admin}',null,'admin'),('${legacy}','${unitA}','solicitante'),('${other}','${unitB}','solicitante');
    `);
    await db.exec(identityMigration);
    await db.exec(`update os_professionals set institutional_email='takeover@one.edu' where auth_user_id='${other}'`);

    const save = (email, name, unit, role, active=true) => asUser(admin,
      `select os_save_professional_membership(null,null,'${email}','${name}','','',${unit ? `'${unit}'` : "null"},'${role}',${active},${active}) as id`);
    await save("first@one.edu", "Primeiro acesso", unitA, "solicitante");
    await save("inactive@one.edu", "Inativo", unitA, "solicitante", false);
    await save("multi@two.edu", "Múltiplos vínculos", unitA, "solicitante");
    const multiProfessional = (await db.query("select id from os_professionals where institutional_email='multi@two.edu'")).rows[0].id;
    await asUser(admin, `select os_save_professional_membership(null,'${multiProfessional}','multi@two.edu','Múltiplos vínculos','','','${unitB}','responsavel',true,true)`);
    await db.exec(`
      insert into os_professionals(institutional_email,name) values('nomember@one.edu','Sem vínculo');
    `);
    await save("deactivated@one.edu", "Depois desativado", unitA, "solicitante");

    await t.test("funcionário já vinculado e Google correto mantém acesso", async () => {
      const result = await claim(other);
      assert.equal(result.result, "already_linked");
      assert.equal(result.active_memberships, 1);
    });
    await t.test("funcionário cadastrado sem auth_user_id vincula no primeiro login", async () => {
      const result = await claim(first);
      assert.equal(result.result, "linked");
      assert.equal(result.active_memberships, 1);
    });
    await t.test("segundo login é idempotente e não duplica o primeiro vínculo", async () => {
      assert.equal((await claim(first)).result, "already_linked");
      const events = await db.query(`select count(*)::int n from os_identity_events where actor_auth_user_id='${first}' and event_type='google_linked'`);
      assert.equal(Number(events.rows[0].n), 1);
    });
    await t.test("e-mail permitido sem cadastro permanece sem acesso", async () => {
      assert.equal((await claim(unknown)).result, "not_registered");
    });
    await t.test("domínio não permitido é barrado antes da associação", () => {
      assert.equal(isAllowedGoogleEmail("pessoa@gmail.com", ["one.edu", "two.edu"]), false);
    });
    await t.test("profissional inativo não recebe identidade", async () => {
      assert.equal((await claim(inactive)).result, "inactive");
      assert.equal((await db.query(`select auth_user_id from os_professionals where institutional_email='inactive@one.edu'`)).rows[0].auth_user_id, null);
    });
    await t.test("profissional já vinculado a outra identidade rejeita tomada de conta", async () => {
      assert.equal((await claim(takeover)).result, "identity_conflict");
    });
    await t.test("profissional sem vínculo autentica mas recebe zero permissões", async () => {
      const result = await claim(noMembership);
      assert.equal(result.result, "linked");
      assert.equal(result.active_memberships, 0);
    });
    await t.test("profissional desativado perde vínculos de autorização", async () => {
      await claim(deactivated);
      const professional = (await db.query("select id from os_professionals where institutional_email='deactivated@one.edu'")).rows[0];
      await db.exec(`update os_memberships set active=false where professional_id='${professional.id}'; update os_professionals set active=false where id='${professional.id}'`);
      assert.equal((await claim(deactivated)).result, "inactive");
      assert.equal(Number((await db.query(`select count(*)::int n from os_memberships where professional_id='${professional.id}' and active`)).rows[0].n), 0);
    });
    await t.test("múltiplos domínios configurados associam pelo e-mail exato", async () => {
      assert.equal(isAllowedGoogleEmail("multi@two.edu", ["one.edu", "two.edu"]), true);
      assert.equal((await claim(multi)).result, "linked");
    });
    await t.test("papéis em unidades diferentes são preservados no primeiro vínculo", async () => {
      const rows = await db.query(`select role,unit_id,user_id from os_memberships where professional_id='${multiProfessional}' order by role`);
      assert.equal(rows.rows.length, 2);
      assert.ok(rows.rows.every((row) => row.user_id === multi));
    });
    await t.test("usuário legado e novo modelo coexistem sem recriar identidade", async () => {
      const row = (await db.query(`select p.auth_user_id,m.user_id from os_professionals p join os_memberships m on m.professional_id=p.id where p.id='${legacy}'`)).rows[0];
      assert.deepEqual(row, { auth_user_id: legacy, user_id: legacy });
    });
    await t.test("RLS expõe o profissional somente a ele próprio ou ao administrador", async () => {
      assert.equal(Number((await asUser(first, "select count(*)::int n from os_professionals")).rows[0].n), 1);
      assert.equal(Number((await asUser(unknown, "select count(*)::int n from os_professionals")).rows[0].n), 0);
      assert.ok(Number((await asUser(admin, "select count(*)::int n from os_professionals")).rows[0].n) >= 8);
      await assert.rejects(
        asUser(first, "update os_professionals set active=false where auth_user_id=auth.uid()"),
        /permission denied|row-level security/i,
      );
    });
    await t.test("administrador não pode desvincular a própria identidade", async () => {
      await assert.rejects(
        asUser(admin, `select os_prepare_professional_identity_change('${admin}','novo@one.edu','Correção administrativa autorizada')`),
        /própria identidade/i,
      );
    });
  } finally {
    await db.close();
  }
});
