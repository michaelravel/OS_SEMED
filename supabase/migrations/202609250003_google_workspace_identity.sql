-- Identidade profissional separada da autenticação Supabase.
-- Migration aditiva: preserva auth.users, os_profiles, vínculos e login legado.
begin;

create table public.os_professionals (
  id uuid primary key default gen_random_uuid(),
  institutional_email text,
  name text not null,
  registration text not null default '',
  job_title text not null default '',
  active boolean not null default true,
  auth_user_id uuid references auth.users(id) on delete restrict,
  previous_auth_user_id uuid references auth.users(id) on delete set null,
  identity_linked_at timestamptz,
  identity_unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_professionals_email_format check (
    institutional_email is null or (
      institutional_email = lower(btrim(institutional_email)) and
      institutional_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and
      length(institutional_email) <= 254
    )
  ),
  constraint os_professionals_name_length check (length(btrim(name)) between 1 and 200),
  constraint os_professionals_registration_length check (length(registration) <= 80),
  constraint os_professionals_job_title_length check (length(job_title) <= 160)
);

create unique index os_professionals_email_unique
  on public.os_professionals(institutional_email)
  where institutional_email is not null;
create unique index os_professionals_auth_user_unique
  on public.os_professionals(auth_user_id)
  where auth_user_id is not null;

-- O id é reaproveitado apenas no backfill para tornar a adaptação determinística.
-- E-mail não é inferido: o schema público histórico não o armazenava.
insert into public.os_professionals(id,name,auth_user_id,identity_linked_at)
select p.id,p.name,p.id,now()
from public.os_profiles p
on conflict(id) do nothing;

alter table public.os_memberships
  add column professional_id uuid references public.os_professionals(id) on delete restrict;

update public.os_memberships m
set professional_id = p.id
from public.os_professionals p
where p.auth_user_id = m.user_id and m.professional_id is null;

create function os_private.attach_membership_professional()
returns trigger language plpgsql security definer set search_path = '' as $$
declare linked_professional uuid;
begin
  if new.professional_id is null and new.user_id is not null then
    select id into linked_professional from public.os_professionals where auth_user_id=new.user_id;
    if linked_professional is null then
      insert into public.os_professionals(id,name,auth_user_id,identity_linked_at)
      select new.user_id,p.name,new.user_id,now() from public.os_profiles p where p.id=new.user_id
      on conflict(id) do nothing;
      select id into linked_professional from public.os_professionals where auth_user_id=new.user_id;
    end if;
    if linked_professional is null then raise exception 'Profissional não encontrado para a identidade'; end if;
    new.professional_id := linked_professional;
  end if;
  return new;
end;
$$;
create trigger memberships_attach_professional
  before insert or update of user_id,professional_id on public.os_memberships
  for each row execute function os_private.attach_membership_professional();

alter table public.os_memberships alter column professional_id set not null;

alter table public.os_memberships alter column user_id drop not null;
alter table public.os_memberships
  drop constraint if exists os_memberships_user_id_unit_id_role_key;
create unique index os_memberships_auth_role_unique
  on public.os_memberships(user_id,unit_id,role) nulls not distinct
  where user_id is not null;
create unique index os_memberships_professional_role_unique
  on public.os_memberships(professional_id,unit_id,role) nulls not distinct
  where professional_id is not null;
create index os_memberships_professional_id on public.os_memberships(professional_id);

-- Compatibilidade com a RPC legada: o índice parcial não pode ser inferido
-- por ON CONFLICT(colunas), portanto a reativação passa a ser explícita.
create or replace function public.os_grant_admin(
  target_user uuid,
  target_name text,
  replaced_membership uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_member public.os_memberships%rowtype;
  saved_id uuid;
  linked_professional uuid;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if length(trim(coalesce(target_name,''))) not between 1 and 200 then raise exception 'Nome inválido'; end if;
  perform pg_advisory_xact_lock(240920260001);
  if replaced_membership is not null then
    select * into current_member from public.os_memberships where id=replaced_membership for update;
    if not found or current_member.user_id<>target_user then raise exception 'Vínculo de origem inválido'; end if;
    if current_member.role<>'admin' then update public.os_memberships set active=false where id=current_member.id; end if;
  end if;
  insert into public.os_profiles(id,name) values(target_user,trim(target_name))
  on conflict(id) do update set name=excluded.name;
  select id into linked_professional from public.os_professionals where auth_user_id=target_user;
  select id into saved_id from public.os_memberships
    where user_id=target_user and unit_id is null and role='admin' for update;
  if saved_id is null then
    insert into public.os_memberships(professional_id,user_id,unit_id,role,active)
    values(linked_professional,target_user,null,'admin',true) returning id into saved_id;
  else
    update public.os_memberships set active=true,
      professional_id=coalesce(professional_id,linked_professional) where id=saved_id;
  end if;
  return saved_id;
end;
$$;

create table public.os_identity_events (
  id bigint generated always as identity primary key,
  professional_id uuid references public.os_professionals(id) on delete restrict,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in (
    'google_linked','google_relinked','access_not_registered','domain_rejected',
    'professional_inactive','identity_conflict','professional_created',
    'professional_updated','professional_deactivated','identity_change_authorized',
    'identity_unlinked','identity_restored'
  )),
  email_domain text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint os_identity_events_metadata_object check(jsonb_typeof(metadata) = 'object'),
  constraint os_identity_events_domain_length check(length(coalesce(email_domain,'')) <= 253)
);
create index os_identity_events_professional_created
  on public.os_identity_events(professional_id,created_at desc);

alter table public.os_professionals enable row level security;
alter table public.os_identity_events enable row level security;

create policy professionals_read on public.os_professionals for select to authenticated
  using(auth_user_id = (select auth.uid()) or os_private.is_admin());
create policy identity_events_admin_read on public.os_identity_events for select to authenticated
  using(os_private.is_admin());

revoke all on public.os_professionals, public.os_identity_events from public, anon, authenticated;
grant select on public.os_professionals, public.os_identity_events to authenticated;
grant all on public.os_professionals, public.os_identity_events to service_role;
grant usage, select on sequence public.os_identity_events_id_seq to service_role;

create function os_private.prevent_identity_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Eventos de identidade são imutáveis';
end;
$$;
create trigger identity_events_immutable
  before update or delete on public.os_identity_events
  for each row execute function os_private.prevent_identity_event_mutation();

-- Um administrador pendente, ainda sem identidade, não conta como proteção do
-- último administrador operacional.
create or replace function os_private.ensure_admin_remaining()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.unit_id is null and old.active and old.user_id is not null and (
    tg_op = 'DELETE' or new.role <> 'admin' or new.unit_id is not null or
    not new.active or new.user_id is null
  ) then
    perform pg_advisory_xact_lock(240920260001);
    if not exists(
      select 1 from public.os_memberships m
      where m.id <> old.id and m.role = 'admin' and m.unit_id is null
        and m.active and m.user_id is not null
    ) then
      raise exception 'Não é permitido remover o último administrador ativo';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.os_claim_professional_identity()
returns table(result text, professional_id uuid, active_memberships integer)
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  authenticated_email text;
  authenticated_domain text;
  provider_data jsonb;
  confirmed_at timestamptz;
  professional public.os_professionals%rowtype;
  was_relink boolean := false;
  already_linked boolean := false;
begin
  if caller is null then raise exception 'Autenticação obrigatória'; end if;

  select lower(btrim(u.email)),u.raw_app_meta_data,u.email_confirmed_at
  into authenticated_email,provider_data,confirmed_at
  from auth.users u where u.id = caller;
  authenticated_domain := split_part(coalesce(authenticated_email,''),'@',2);

  if authenticated_email is null or confirmed_at is null or not (
    provider_data ->> 'provider' = 'google' or
    coalesce(provider_data -> 'providers','[]'::jsonb) ? 'google'
  ) then
    insert into public.os_identity_events(actor_auth_user_id,event_type,email_domain)
    values(caller,'identity_conflict',nullif(authenticated_domain,''));
    return query select 'unverified_provider'::text,null::uuid,0;
    return;
  end if;

  select * into professional from public.os_professionals p
  where p.auth_user_id = caller for update;
  if found then
    already_linked := true;
    if professional.institutional_email is null then
      update public.os_professionals set institutional_email=authenticated_email,
        updated_at=now() where id=professional.id;
    elsif professional.institutional_email <> authenticated_email then
      insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain)
      values(professional.id,caller,'identity_conflict',authenticated_domain);
      return query select 'identity_conflict'::text,professional.id,0;
      return;
    end if;
  else
    select * into professional from public.os_professionals p
    where p.institutional_email = authenticated_email for update;
    if not found then
      insert into public.os_identity_events(actor_auth_user_id,event_type,email_domain)
      values(caller,'access_not_registered',authenticated_domain);
      return query select 'not_registered'::text,null::uuid,0;
      return;
    end if;
    if not professional.active then
      insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain)
      values(professional.id,caller,'professional_inactive',authenticated_domain);
      return query select 'inactive'::text,professional.id,0;
      return;
    end if;
    if professional.auth_user_id is not null or exists(
      select 1 from public.os_professionals p where p.auth_user_id=caller and p.id<>professional.id
    ) or professional.previous_auth_user_id = caller then
      insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain)
      values(professional.id,caller,'identity_conflict',authenticated_domain);
      return query select 'identity_conflict'::text,professional.id,0;
      return;
    end if;
    was_relink := professional.previous_auth_user_id is not null;
    update public.os_professionals set auth_user_id=caller,
      identity_linked_at=now(),identity_unlinked_at=null,updated_at=now()
    where id=professional.id;
  end if;

  if not professional.active then
    insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain)
    values(professional.id,caller,'professional_inactive',authenticated_domain);
    return query select 'inactive'::text,professional.id,0;
    return;
  end if;

  insert into public.os_profiles(id,name) values(caller,professional.name)
  on conflict(id) do update set name=excluded.name;
  update public.os_memberships set user_id=caller
  where os_memberships.professional_id=professional.id and user_id is null;

  if not already_linked then
    insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain)
    values(professional.id,caller,case when was_relink then 'google_relinked' else 'google_linked' end,
      authenticated_domain);
  end if;
  return query select case when already_linked then 'already_linked'
      when was_relink then 'relinked' else 'linked' end,
    professional.id,count(*)::integer
  from public.os_memberships m
  where m.professional_id=professional.id and m.active and m.user_id=caller;
end;
$$;

create function public.os_record_identity_denial(denial_type text, denied_domain text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if denial_type <> 'domain_rejected' then raise exception 'Evento inválido'; end if;
  insert into public.os_identity_events(actor_auth_user_id,event_type,email_domain)
  values(auth.uid(),'domain_rejected',left(lower(btrim(denied_domain)),253));
end;
$$;

create function public.os_professional_memberships(page_size integer default 25,page_offset integer default 0)
returns table(
  membership_id uuid,professional_id uuid,professional_name text,institutional_email text,
  registration text,job_title text,professional_active boolean,identity_linked boolean,
  relink_pending boolean,unit_id uuid,role text,membership_active boolean,total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  return query
  select m.id,p.id,p.name,p.institutional_email,p.registration,p.job_title,p.active,
    p.auth_user_id is not null,p.auth_user_id is null and p.previous_auth_user_id is not null,
    m.unit_id,m.role,m.active,count(*) over()
  from public.os_professionals p
  left join public.os_memberships m on m.professional_id=p.id
  order by p.name,m.id
  limit greatest(1,least(coalesce(page_size,25),100))
  offset greatest(coalesce(page_offset,0),0);
end;
$$;

create function public.os_save_professional_membership(
  target_membership uuid,target_professional uuid,professional_email text,
  professional_name text,professional_registration text,professional_position text,
  target_unit uuid,target_role text,professional_active boolean,membership_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_member public.os_memberships%rowtype;
  current_professional public.os_professionals%rowtype;
  saved_professional uuid;
  saved_membership uuid;
  normalized_email text := nullif(lower(btrim(professional_email)),'');
  previous_active boolean;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if length(btrim(coalesce(professional_name,''))) not between 1 and 200 or
    length(coalesce(professional_registration,'')) > 80 or
    length(coalesce(professional_position,'')) > 160 or
    target_role not in ('admin','gestor','solicitante','responsavel') or
    professional_active is null or membership_active is null then
    raise exception 'Cadastro profissional inválido';
  end if;
  if normalized_email is not null and (
    length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then raise exception 'E-mail inválido'; end if;
  if target_professional is null and normalized_email is null then raise exception 'E-mail obrigatório'; end if;
  if target_role in ('solicitante','responsavel') and target_unit is null then
    raise exception 'Unidade obrigatória para o papel';
  end if;
  if target_role='admin' and target_unit is not null then raise exception 'Administrador deve ser global'; end if;
  if target_unit is not null and not exists(select 1 from public.os_units u where u.id=target_unit and u.active)
    then raise exception 'Unidade inválida'; end if;

  if target_professional is null then
    insert into public.os_professionals(institutional_email,name,registration,job_title,active)
    values(normalized_email,btrim(professional_name),professional_registration,professional_position,professional_active)
    returning id into saved_professional;
    insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain)
    values(saved_professional,auth.uid(),'professional_created',split_part(normalized_email,'@',2));
  else
    select * into current_professional from public.os_professionals where id=target_professional for update;
    if not found then raise exception 'Profissional não encontrado'; end if;
    if current_professional.auth_user_id=auth.uid() and not professional_active then
      raise exception 'Não é permitido desativar o próprio acesso';
    end if;
    if current_professional.auth_user_id is not null and normalized_email is distinct from current_professional.institutional_email
      then raise exception 'Use a operação específica de alteração de identidade'; end if;
    previous_active := current_professional.active;
    update public.os_professionals set
      institutional_email=coalesce(normalized_email,institutional_email),name=btrim(professional_name),
      registration=professional_registration,job_title=professional_position,active=professional_active,updated_at=now()
    where id=target_professional returning id into saved_professional;
    if previous_active and not professional_active then
      update public.os_memberships set active=false where os_memberships.professional_id=saved_professional;
    end if;
    insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain)
    values(saved_professional,auth.uid(),case when previous_active and not professional_active
      then 'professional_deactivated' else 'professional_updated' end,
      split_part(coalesce(normalized_email,current_professional.institutional_email),'@',2));
  end if;

  if target_membership is not null then
    select * into current_member from public.os_memberships where id=target_membership for update;
    if not found or current_member.professional_id is distinct from saved_professional then
      raise exception 'Vínculo inválido'; end if;
    if current_member.user_id=auth.uid() and (
      not membership_active or target_role<>'admin' or target_unit is not null
    ) then raise exception 'Não é permitido remover o próprio papel administrativo'; end if;
    update public.os_memberships set unit_id=target_unit,role=target_role,
      active=membership_active and professional_active
    where id=target_membership returning id into saved_membership;
  else
    insert into public.os_memberships(professional_id,user_id,unit_id,role,active)
    select saved_professional,p.auth_user_id,target_unit,target_role,membership_active and professional_active
    from public.os_professionals p where p.id=saved_professional
    returning id into saved_membership;
  end if;
  return saved_membership;
end;
$$;

create function public.os_prepare_professional_identity_change(
  target_professional uuid,new_email text,justification text
) returns void language plpgsql security definer set search_path = '' as $$
declare p public.os_professionals%rowtype; normalized_email text:=lower(btrim(new_email));
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(btrim(coalesce(justification,'')))<10 then raise exception 'Alteração de identidade inválida'; end if;
  select * into p from public.os_professionals where id=target_professional for update;
  if not found or p.auth_user_id is null then raise exception 'Identidade vinculada não encontrada'; end if;
  if p.auth_user_id=auth.uid() then raise exception 'Não é permitido desvincular a própria identidade'; end if;
  update public.os_professionals set institutional_email=normalized_email,
    previous_auth_user_id=auth_user_id,auth_user_id=null,identity_unlinked_at=now(),updated_at=now()
  where id=target_professional;
  update public.os_memberships set user_id=null where professional_id=target_professional;
  insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain,metadata)
  values(target_professional,auth.uid(),'identity_unlinked',split_part(normalized_email,'@',2),
    jsonb_build_object('reason',left(btrim(justification),500)));
  insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain)
  values(target_professional,auth.uid(),'identity_change_authorized',split_part(normalized_email,'@',2));
end;
$$;

create function public.os_restore_professional_identity(target_professional uuid,justification text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.os_professionals%rowtype;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if length(btrim(coalesce(justification,'')))<10 then raise exception 'Justificativa obrigatória'; end if;
  select * into p from public.os_professionals where id=target_professional for update;
  if not found or p.auth_user_id is not null or p.previous_auth_user_id is null then
    raise exception 'Não há identidade anterior para restaurar'; end if;
  if exists(select 1 from public.os_professionals x where x.auth_user_id=p.previous_auth_user_id)
    then raise exception 'Identidade já utilizada'; end if;
  update public.os_professionals set auth_user_id=previous_auth_user_id,
    identity_linked_at=now(),identity_unlinked_at=null,updated_at=now() where id=target_professional;
  insert into public.os_profiles(id,name) values(p.previous_auth_user_id,p.name)
  on conflict(id) do update set name=excluded.name;
  update public.os_memberships set user_id=p.previous_auth_user_id where professional_id=target_professional;
  insert into public.os_identity_events(professional_id,actor_auth_user_id,event_type,email_domain,metadata)
  values(target_professional,auth.uid(),'identity_restored',split_part(p.institutional_email,'@',2),
    jsonb_build_object('reason',left(btrim(justification),500)));
end;
$$;

revoke all on function os_private.prevent_identity_event_mutation() from public,anon,authenticated;
revoke all on function os_private.attach_membership_professional() from public,anon,authenticated;
revoke all on function public.os_claim_professional_identity() from public,anon;
revoke all on function public.os_record_identity_denial(text,text) from public,anon;
revoke all on function public.os_professional_memberships(integer,integer) from public,anon;
revoke all on function public.os_save_professional_membership(uuid,uuid,text,text,text,text,uuid,text,boolean,boolean) from public,anon;
revoke all on function public.os_prepare_professional_identity_change(uuid,text,text) from public,anon;
revoke all on function public.os_restore_professional_identity(uuid,text) from public,anon;
grant execute on function public.os_claim_professional_identity() to authenticated;
grant execute on function public.os_record_identity_denial(text,text) to authenticated;
grant execute on function public.os_professional_memberships(integer,integer) to authenticated;
grant execute on function public.os_save_professional_membership(uuid,uuid,text,text,text,text,uuid,text,boolean,boolean) to authenticated;
grant execute on function public.os_prepare_professional_identity_change(uuid,text,text) to authenticated;
grant execute on function public.os_restore_professional_identity(uuid,text) to authenticated;

commit;
