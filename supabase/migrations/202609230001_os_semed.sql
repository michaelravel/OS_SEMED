-- Nova instalação OS_SEMED. Não aplicar em um schema legado sem revisão.
begin;
create schema os_private;
revoke all on schema os_private from public;
grant usage on schema os_private to authenticated;

create table public.os_units (
  id uuid primary key default gen_random_uuid(), legacy_id text unique,
  name text not null check (length(name) between 1 and 300),
  type text not null default '', address text not null default '', coordinates text not null default '',
  active boolean not null default true
);
create table public.os_profiles (
  id uuid primary key references auth.users(id), name text not null check (length(name) between 1 and 200)
);
create table public.os_memberships (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.os_profiles(id),
  unit_id uuid references public.os_units(id),
  role text not null check (role in ('admin','gestor','solicitante','responsavel')),
  active boolean not null default true,
  check (unit_id is not null or role in ('admin','gestor')),
  check (role <> 'admin' or unit_id is null),
  unique nulls not distinct (user_id,unit_id,role)
);
create index os_memberships_user on public.os_memberships(user_id) where active;
create table public.os_catalogs (
  id uuid primary key default gen_random_uuid(), legacy_id text not null,
  kind text not null check (kind in ('logistics','routes','vehicles','drivers')),
  name text not null check(length(name) between 1 and 500),
  data jsonb not null default '{}' check(jsonb_typeof(data) = 'object'),
  active boolean not null default true, unique(kind,legacy_id)
);
create index os_catalogs_kind on public.os_catalogs(kind, name);
create table public.os_orders (
  id uuid primary key default gen_random_uuid(), legacy_id text unique,
  unit_id uuid references public.os_units(id), opened_by uuid references public.os_profiles(id),
  responsible_id uuid references public.os_profiles(id),
  category_id uuid references public.os_catalogs(id),
  title text not null check(length(title) between 1 and 500),
  status text not null default 'Aberta' check(status in ('A conferir','Aberta','Em análise','Em execução','Aguardando material','Aguardando deslocamento/logística','Concluída','Cancelada')),
  details jsonb not null default '{}' check(jsonb_typeof(details) = 'object'),
  opened_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), active boolean not null default true
);
create index os_orders_unit_date on public.os_orders(unit_id,created_at desc);
create index os_orders_author on public.os_orders(opened_by);
create index os_orders_responsible on public.os_orders(responsible_id);
create table public.os_messages (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.os_orders(id),
  author_id uuid not null default auth.uid() references public.os_profiles(id),
  body text not null check(length(body) between 1 and 5000), created_at timestamptz not null default now()
);
create index os_messages_order on public.os_messages(order_id,created_at);
create table public.os_attachments (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.os_orders(id),
  uploaded_by uuid not null default auth.uid() references public.os_profiles(id),
  name text not null check(length(name) between 1 and 250), path text unique not null,
  mime_type text not null, size_bytes integer not null check(size_bytes between 1 and 3145728),
  created_at timestamptz not null default now()
);
create index os_attachments_order on public.os_attachments(order_id);
create table public.os_audit (
  id bigint generated always as identity primary key, actor uuid, entity text not null,
  record_id text not null, action text not null, before_data jsonb, after_data jsonb,
  created_at timestamptz not null default now()
);
-- Arquivo fiel de origem, acessível somente a administradores; nunca servido como asset.
create table public.os_import_records (
  source text not null, source_id text not null, payload jsonb not null,
  primary key(source,source_id)
);

create function os_private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.os_memberships where user_id = (select auth.uid()) and active and role = 'admin' and unit_id is null);
$$;
create function os_private.has_membership() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.os_memberships where user_id = (select auth.uid()) and active);
$$;
create function os_private.can_read_order(o public.os_orders) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.os_memberships m where m.user_id = (select auth.uid()) and m.active and (
    (m.role in ('admin','gestor') and (m.unit_id is null or m.unit_id = o.unit_id)) or
    (m.unit_id = o.unit_id and ((m.role = 'solicitante' and o.opened_by = m.user_id) or (m.role = 'responsavel' and o.responsible_id = m.user_id)))
  ));
$$;
create function os_private.can_write_order(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.os_orders o join public.os_memberships m on m.user_id = (select auth.uid()) and m.active
    where o.id = target and o.active and (
      (m.role = 'admin' and (m.unit_id is null or m.unit_id = o.unit_id)) or
      (m.unit_id = o.unit_id and ((m.role = 'solicitante' and o.opened_by = m.user_id) or (m.role = 'responsavel' and o.responsible_id = m.user_id)))
    ));
$$;
create function os_private.can_read_order_id(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.os_orders o where o.id = target and os_private.can_read_order(o));
$$;
create function os_private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.os_audit(actor,entity,record_id,action,before_data,after_data)
  values(auth.uid(),tg_table_name,coalesce(new.id,old.id)::text,tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create function os_private.validate_order() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Importação administrativa preserva registros sem vínculos para conciliação.
  if auth.uid() is null then return new; end if;
  if new.unit_id is null or not exists(select 1 from public.os_units where id=new.unit_id and active) then
    raise exception 'Unidade inválida';
  end if;
  if new.category_id is not null and not exists(select 1 from public.os_catalogs where id=new.category_id and kind='logistics' and active) then
    raise exception 'Classificação inválida';
  end if;
  if tg_op = 'INSERT' and new.category_id is null then raise exception 'Classificação obrigatória'; end if;
  if new.responsible_id is not null and not exists(select 1 from public.os_memberships where user_id=new.responsible_id and unit_id=new.unit_id and role='responsavel' and active) then
    raise exception 'Responsável sem vínculo';
  end if;
  if new.opened_by is not null and not exists(select 1 from public.os_memberships where user_id=new.opened_by and active and ((role='admin' and unit_id is null) or (role='solicitante' and unit_id=new.unit_id))) then
    raise exception 'Solicitante sem vínculo';
  end if;
  if tg_op = 'INSERT' then new.created_at=now(); new.opened_at=now(); end if;
  new.updated_at=now();
  return new;
end; $$;
create trigger validate_order before insert or update on public.os_orders for each row execute function os_private.validate_order();

alter table public.os_units enable row level security;
alter table public.os_profiles enable row level security;
alter table public.os_memberships enable row level security;
alter table public.os_catalogs enable row level security;
alter table public.os_orders enable row level security;
alter table public.os_messages enable row level security;
alter table public.os_attachments enable row level security;
alter table public.os_audit enable row level security;
alter table public.os_import_records enable row level security;

create policy units_read on public.os_units for select to authenticated using (
  os_private.is_admin() or exists(select 1 from public.os_memberships m where m.user_id = (select auth.uid()) and m.active and (m.unit_id = os_units.id or (m.unit_id is null and m.role = 'gestor')))
);
create policy units_admin on public.os_units for all to authenticated using(os_private.is_admin()) with check(os_private.is_admin());
create policy profiles_read on public.os_profiles for select to authenticated using(id = (select auth.uid()) or os_private.is_admin());
create policy profiles_admin on public.os_profiles for all to authenticated using(os_private.is_admin()) with check(os_private.is_admin());
create policy memberships_read on public.os_memberships for select to authenticated using(user_id = (select auth.uid()) or os_private.is_admin());
create policy memberships_admin on public.os_memberships for all to authenticated using(os_private.is_admin()) with check(os_private.is_admin());
create policy catalogs_read on public.os_catalogs for select to authenticated using(os_private.has_membership());
create policy catalogs_admin on public.os_catalogs for all to authenticated using(os_private.is_admin()) with check(os_private.is_admin());
create policy orders_read on public.os_orders for select to authenticated using(os_private.can_read_order(os_orders));
create policy orders_insert on public.os_orders for insert to authenticated with check (
  opened_by = (select auth.uid()) and status = 'Aberta' and active and unit_id is not null
  and responsible_id is null and legacy_id is null
  and exists(select 1 from public.os_memberships m where m.user_id = (select auth.uid()) and m.active and (
    (m.role = 'admin' and (m.unit_id is null or m.unit_id = os_orders.unit_id)) or (m.role = 'solicitante' and m.unit_id = os_orders.unit_id)
  ))
);
create policy orders_update on public.os_orders for update to authenticated using(os_private.is_admin()) with check(os_private.is_admin());
create policy messages_read on public.os_messages for select to authenticated using(os_private.can_read_order_id(order_id));
create policy messages_insert on public.os_messages for insert to authenticated with check(author_id = (select auth.uid()) and os_private.can_write_order(order_id));
create policy attachments_read on public.os_attachments for select to authenticated using(os_private.can_read_order_id(order_id));
create policy attachments_insert on public.os_attachments for insert to authenticated with check(
  uploaded_by = (select auth.uid()) and os_private.can_write_order(order_id)
  and path = order_id::text || '/' || id::text
);
create policy attachments_cleanup on public.os_attachments for delete to authenticated using(
  uploaded_by = (select auth.uid()) and os_private.can_write_order(order_id)
  and not exists(select 1 from storage.objects s where s.bucket_id = 'os-attachments' and s.name = os_attachments.path)
);
create policy audit_read on public.os_audit for select to authenticated using(os_private.is_admin());
create policy imports_read on public.os_import_records for select to authenticated using(os_private.is_admin());

-- Responsável altera somente status; identidade e vínculo são verificados no banco.
create function public.os_change_status(target uuid, next_status text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if next_status not in ('Aberta','Em análise','Em execução','Aguardando material','Aguardando deslocamento/logística','Concluída','Cancelada') or next_status is null then raise exception 'Status inválido'; end if;
  update public.os_orders o set status = next_status, updated_at = now()
  where o.id = target and o.active and (os_private.is_admin() or exists (
    select 1 from public.os_memberships m where m.user_id = auth.uid() and m.active and m.role = 'responsavel'
      and m.unit_id = o.unit_id and o.responsible_id = m.user_id
  ));
  if not found then raise exception 'Acesso negado'; end if;
end; $$;

create trigger orders_audit after insert or update or delete on public.os_orders for each row execute function os_private.audit_change();
create trigger memberships_audit after insert or update or delete on public.os_memberships for each row execute function os_private.audit_change();
create trigger catalogs_audit after insert or update or delete on public.os_catalogs for each row execute function os_private.audit_change();
create trigger units_audit after insert or update or delete on public.os_units for each row execute function os_private.audit_change();
create trigger messages_audit after insert on public.os_messages for each row execute function os_private.audit_change();

revoke all on all functions in schema os_private from public, anon;
grant execute on all functions in schema os_private to authenticated;
revoke execute on function os_private.audit_change() from authenticated;
revoke execute on function os_private.validate_order() from authenticated;
revoke all on function public.os_change_status(uuid,text) from public, anon;
grant execute on function public.os_change_status(uuid,text) to authenticated;
revoke all on public.os_units, public.os_profiles, public.os_memberships, public.os_catalogs, public.os_orders, public.os_messages, public.os_attachments, public.os_audit, public.os_import_records from anon, authenticated;
grant select, insert, update on public.os_units, public.os_profiles, public.os_memberships, public.os_catalogs, public.os_orders to authenticated;
grant select, insert on public.os_messages, public.os_attachments to authenticated;
grant delete on public.os_attachments to authenticated;
grant select on public.os_audit, public.os_import_records to authenticated;
grant all on public.os_units, public.os_profiles, public.os_memberships, public.os_catalogs, public.os_orders, public.os_messages, public.os_attachments, public.os_audit, public.os_import_records to service_role;
grant usage, select on sequence public.os_audit_id_seq to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('os-attachments','os-attachments',false,3145728,array['application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
-- Compare texto antes de UUID para não lançar erro em caminhos malformados.
create policy os_files_read on storage.objects for select to authenticated using(
  bucket_id = 'os-attachments' and exists(select 1 from public.os_orders o where o.id::text = split_part(storage.objects.name,'/',1) and os_private.can_read_order(o))
);
create policy os_files_insert on storage.objects for insert to authenticated with check(
  bucket_id = 'os-attachments' and exists(select 1 from public.os_attachments a where a.path = storage.objects.name and a.uploaded_by = (select auth.uid()) and os_private.can_write_order(a.order_id))
);
commit;
