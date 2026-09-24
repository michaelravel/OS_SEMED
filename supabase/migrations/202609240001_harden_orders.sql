-- Regras incrementais de integridade, histórico e autorização.
-- Aplicar somente depois de 202609230001_os_semed.sql.
begin;

alter table public.os_orders
  add column protocol bigint generated always as identity,
  add column priority text not null default 'Normal'
    check (priority in ('Baixa','Normal','Alta','Urgente')),
  add column status_reason text not null default '' check (length(status_reason) <= 2000),
  add column completed_at timestamptz,
  add column cancelled_at timestamptz;
alter table public.os_orders add constraint os_orders_protocol_key unique(protocol);
create index os_orders_status_date on public.os_orders(status,created_at desc) where active;

alter table public.os_attachments add constraint os_attachments_mime_type_check check (
  mime_type in (
    'application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
);

create table public.os_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.os_orders(id) on delete cascade,
  actor uuid references public.os_profiles(id),
  from_status text,
  to_status text not null,
  reason text not null default '' check (length(reason) <= 2000),
  created_at timestamptz not null default now()
);
create index os_order_events_order_date
  on public.os_order_events(order_id,created_at desc);
alter table public.os_order_events enable row level security;
create policy order_events_read on public.os_order_events for select to authenticated
  using(os_private.can_read_order_id(order_id));
revoke all on public.os_order_events from anon, authenticated;
grant select on public.os_order_events to authenticated;
grant all on public.os_order_events to service_role;
grant usage, select on sequence public.os_order_events_id_seq to service_role;

insert into public.os_order_events(order_id,actor,from_status,to_status,reason,created_at)
select id,null,null,status,'Estado registrado na implantação do histórico',coalesce(opened_at,created_at)
from public.os_orders;

drop policy catalogs_read on public.os_catalogs;
create policy catalogs_read on public.os_catalogs for select to authenticated using(
  os_private.is_admin() or (active and os_private.has_membership())
);

create or replace function os_private.can_write_order(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from public.os_orders o
    join public.os_memberships m
      on m.user_id = (select auth.uid()) and m.active
    where o.id = target
      and o.active
      and o.status not in ('Concluída','Cancelada')
      and (
        (m.role = 'admin' and m.unit_id is null) or
        (m.unit_id = o.unit_id and (
          (m.role = 'solicitante' and o.opened_by = m.user_id) or
          (m.role = 'responsavel' and o.responsible_id = m.user_id)
        ))
      )
  );
$$;

create or replace function os_private.validate_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  catalog_ref record;
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' then
      new.created_at = coalesce(new.created_at,now());
      new.opened_at = coalesce(new.opened_at,now());
    end if;
    new.updated_at = now();
    return new;
  end if;

  if new.unit_id is null or not exists(
    select 1 from public.os_units where id = new.unit_id and active
  ) then raise exception 'Unidade inválida'; end if;
  if new.category_id is not null and not exists(
    select 1 from public.os_catalogs
    where id = new.category_id and kind = 'logistics' and active
  ) then raise exception 'Classificação inválida'; end if;
  if new.responsible_id is not null and not exists(
    select 1 from public.os_memberships
    where user_id = new.responsible_id and unit_id = new.unit_id
      and role = 'responsavel' and active
  ) then raise exception 'Responsável sem vínculo'; end if;
  if new.opened_by is not null and not exists(
    select 1 from public.os_memberships
    where user_id = new.opened_by and active and (
      (role = 'admin' and unit_id is null) or
      (role = 'solicitante' and unit_id = new.unit_id)
    )
  ) then raise exception 'Solicitante sem vínculo'; end if;

  if new.status <> 'A conferir' and (
    new.opened_by is null or new.category_id is null
  ) then raise exception 'Conciliação obrigatória antes de avançar a ordem'; end if;
  if new.status in (
    'Em execução','Aguardando material',
    'Aguardando deslocamento/logística','Concluída'
  ) and new.responsible_id is null then
    raise exception 'Responsável obrigatório para atendimento';
  end if;

  for catalog_ref in
    select * from (values
      ('driver','drivers'),('vehicle','vehicles'),('route','routes')
    ) as refs(detail_key,catalog_kind)
  loop
    if coalesce(new.details ->> catalog_ref.detail_key,'') <> '' and not exists(
      select 1 from public.os_catalogs c
      where c.id::text = new.details ->> catalog_ref.detail_key
        and c.kind = catalog_ref.catalog_kind and c.active
    ) then raise exception 'Referência de catálogo inválida: %', catalog_ref.detail_key;
    end if;
  end loop;

  if tg_op = 'INSERT' then
    new.created_at = now();
    new.opened_at = now();
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create function os_private.ensure_admin_remaining()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.unit_id is null and old.active and (
    tg_op = 'DELETE' or new.role <> 'admin' or new.unit_id is not null or not new.active
  ) and not exists(
    select 1 from public.os_memberships m
    where m.id <> old.id and m.role = 'admin' and m.unit_id is null and m.active
  ) then raise exception 'Não é permitido remover o último administrador ativo'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger memberships_keep_admin
  before update or delete on public.os_memberships
  for each row execute function os_private.ensure_admin_remaining();

drop function public.os_change_status(uuid,text);
create function public.os_change_status(target uuid, next_status text, reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  normalized_reason text := trim(coalesce(reason,''));
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if next_status is null or next_status not in (
    'Aberta','Em análise','Em execução','Aguardando material',
    'Aguardando deslocamento/logística','Concluída','Cancelada'
  ) then raise exception 'Status inválido'; end if;

  select o.* into current_order
  from public.os_orders o
  where o.id = target and o.active and (
    os_private.is_admin() or exists (
      select 1 from public.os_memberships m
      where m.user_id = auth.uid() and m.active and m.role = 'responsavel'
        and m.unit_id = o.unit_id and o.responsible_id = m.user_id
    )
  ) for update;
  if not found then raise exception 'Acesso negado'; end if;
  if current_order.status = next_status then return; end if;

  if not (
    (current_order.status = 'A conferir' and next_status = 'Aberta') or
    (current_order.status = 'Aberta' and next_status in ('Em análise','Cancelada')) or
    (current_order.status = 'Em análise' and next_status in (
      'Em execução','Aguardando material','Aguardando deslocamento/logística','Cancelada'
    )) or
    (current_order.status = 'Em execução' and next_status in (
      'Em análise','Aguardando material','Aguardando deslocamento/logística','Concluída','Cancelada'
    )) or
    (current_order.status in ('Aguardando material','Aguardando deslocamento/logística')
      and next_status in ('Em execução','Cancelada')) or
    (current_order.status = 'Concluída' and next_status = 'Em análise') or
    (current_order.status = 'Cancelada' and next_status = 'Aberta')
  ) then raise exception 'Transição de status inválida'; end if;

  if (next_status in ('Concluída','Cancelada') or
      current_order.status in ('Concluída','Cancelada')) and normalized_reason = '' then
    raise exception 'Informe o motivo da conclusão, cancelamento ou reabertura';
  end if;

  update public.os_orders set
    status = next_status,
    status_reason = normalized_reason,
    completed_at = case
      when next_status = 'Concluída' then now()
      when current_order.status = 'Concluída' then null
      else completed_at end,
    cancelled_at = case
      when next_status = 'Cancelada' then now()
      when current_order.status = 'Cancelada' then null
      else cancelled_at end,
    updated_at = now()
  where id = target;

  insert into public.os_order_events(order_id,actor,from_status,to_status,reason)
  values(target,auth.uid(),current_order.status,next_status,normalized_reason);
end;
$$;

create function public.os_assign_order(
  target uuid,
  target_unit uuid,
  target_responsible uuid,
  target_opened_by uuid,
  target_category uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  update public.os_orders set
    unit_id = target_unit,
    responsible_id = target_responsible,
    opened_by = target_opened_by,
    category_id = target_category
  where id = target and active;
  if not found then raise exception 'Ordem não encontrada'; end if;
end;
$$;

create function public.os_edit_order(
  target uuid,
  new_title text,
  new_priority text,
  detail_patch jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if length(trim(new_title)) not between 3 and 500 then raise exception 'Título inválido'; end if;
  if new_priority not in ('Baixa','Normal','Alta','Urgente') then raise exception 'Prioridade inválida'; end if;
  if jsonb_typeof(detail_patch) <> 'object' then raise exception 'Detalhes inválidos'; end if;
  update public.os_orders set
    title = trim(new_title), priority = new_priority, details = detail_patch
  where id = target and active;
  if not found then raise exception 'Ordem não encontrada'; end if;
end;
$$;

drop policy orders_update on public.os_orders;
revoke update on public.os_orders from authenticated;
revoke all on function public.os_change_status(uuid,text,text) from public, anon;
revoke all on function public.os_assign_order(uuid,uuid,uuid,uuid,uuid) from public, anon;
revoke all on function public.os_edit_order(uuid,text,text,jsonb) from public, anon;
grant execute on function public.os_change_status(uuid,text,text) to authenticated;
grant execute on function public.os_assign_order(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.os_edit_order(uuid,text,text,jsonb) to authenticated;

create trigger profiles_audit after insert or update or delete on public.os_profiles
  for each row execute function os_private.audit_change();
create trigger attachments_audit after insert or delete on public.os_attachments
  for each row execute function os_private.audit_change();

revoke execute on function os_private.ensure_admin_remaining() from public, anon, authenticated;
commit;
