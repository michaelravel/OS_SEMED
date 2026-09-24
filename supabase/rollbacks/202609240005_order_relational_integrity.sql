-- Rollback manual da migration 202609240005_order_relational_integrity.sql.
-- Executar somente após backup e validação em ambiente não produtivo.
-- Preserva as novas referências no JSON antes de remover as colunas.
begin;

alter table public.os_orders disable trigger validate_order;
alter table public.os_orders disable trigger orders_workflow_integrity;
update public.os_orders set details = details
  || case when driver_id is not null then jsonb_build_object('driver',driver_id::text) else '{}'::jsonb end
  || case when vehicle_id is not null then jsonb_build_object('vehicle',vehicle_id::text) else '{}'::jsonb end
  || case when route_id is not null then jsonb_build_object('route',route_id::text) else '{}'::jsonb end
  || case when import_source is not null then jsonb_build_object(
       '_import_source',import_source,'_import_source_id',import_source_id
     ) else '{}'::jsonb end
where driver_id is not null or vehicle_id is not null or route_id is not null
  or import_source is not null;
alter table public.os_orders enable trigger validate_order;
alter table public.os_orders enable trigger orders_workflow_integrity;

create or replace function os_private.can_read_catalog(c public.os_catalogs)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.is_admin() or (
    c.active and exists(
      select 1 from public.os_memberships m
      where m.user_id = (select auth.uid()) and m.active and (
        (m.role = 'solicitante' and exists(
          select 1 from public.os_units u where u.id = m.unit_id and u.active
        )) or
        (m.role = 'gestor' and m.unit_id is null) or
        (m.role in ('gestor','responsavel') and exists(
          select 1 from public.os_orders o where o.unit_id = m.unit_id
            and (m.role = 'gestor' or o.responsible_id = m.user_id)
            and (o.category_id = c.id or o.details ->> 'driver' = c.id::text
              or o.details ->> 'vehicle' = c.id::text
              or o.details ->> 'route' = c.id::text)
        ))
      )
    )
  );
$$;

create or replace function os_private.validate_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare catalog_ref record;
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
    select 1 from public.os_catalogs where id = new.category_id
      and kind = 'logistics' and active
  ) then raise exception 'Classificação inválida'; end if;
  if new.responsible_id is not null and not exists(
    select 1 from public.os_memberships where user_id = new.responsible_id
      and unit_id = new.unit_id and role = 'responsavel' and active
  ) then raise exception 'Responsável sem vínculo'; end if;
  if new.opened_by is not null and not exists(
    select 1 from public.os_memberships where user_id = new.opened_by and active
      and ((role = 'admin' and unit_id is null) or
        (role = 'solicitante' and unit_id = new.unit_id))
  ) then raise exception 'Solicitante sem vínculo'; end if;
  if new.status <> 'A conferir' and (
    new.opened_by is null or new.category_id is null
  ) then raise exception 'Conciliação obrigatória antes de avançar a ordem'; end if;
  if new.status in ('Em execução','Aguardando material',
    'Aguardando deslocamento/logística','Concluída')
    and new.responsible_id is null then
    raise exception 'Responsável obrigatório para atendimento';
  end if;
  for catalog_ref in select * from (values
    ('driver','drivers'),('vehicle','vehicles'),('route','routes')
  ) as refs(detail_key,catalog_kind) loop
    if coalesce(new.details ->> catalog_ref.detail_key,'') <> '' and not exists(
      select 1 from public.os_catalogs c
      where c.id::text = new.details ->> catalog_ref.detail_key
        and c.kind = catalog_ref.catalog_kind and c.active
    ) then raise exception 'Referência de catálogo inválida: %', catalog_ref.detail_key; end if;
  end loop;
  if tg_op = 'INSERT' then new.created_at=now(); new.opened_at=now(); end if;
  new.updated_at=now();
  return new;
end;
$$;

create or replace function public.os_assign_order(
  target uuid,target_unit uuid,target_responsible uuid,
  target_opened_by uuid,target_category uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  update public.os_orders set unit_id=target_unit,
    responsible_id=target_responsible,opened_by=target_opened_by,
    category_id=target_category where id=target and active;
  if not found then raise exception 'Ordem não encontrada'; end if;
end;
$$;

drop trigger if exists catalogs_business_key_integrity on public.os_catalogs;
drop trigger if exists units_name_integrity on public.os_units;
drop trigger if exists memberships_order_integrity on public.os_memberships;
drop function if exists os_private.enforce_catalog_business_key();
drop function if exists os_private.enforce_unit_name_key();
drop function if exists os_private.protect_order_memberships();

drop index if exists public.os_orders_driver;
drop index if exists public.os_orders_vehicle;
drop index if exists public.os_orders_route;
drop index if exists public.os_orders_requester_membership;
drop index if exists public.os_orders_responsible_membership;
drop index if exists public.os_orders_import_record_unique;
drop index if exists public.os_catalogs_driver_code;
drop index if exists public.os_catalogs_vehicle_plate;
drop index if exists public.os_catalogs_route_code;
drop index if exists public.os_units_normalized_name;

alter table public.os_orders
  drop column import_source,
  drop column import_source_id,
  drop column requester_membership_id,
  drop column responsible_membership_id,
  drop column driver_id,
  drop column vehicle_id,
  drop column route_id,
  drop column category_kind,
  drop column driver_kind,
  drop column vehicle_kind,
  drop column route_kind;
alter table public.os_catalogs drop constraint os_catalogs_id_kind_key;

commit;
