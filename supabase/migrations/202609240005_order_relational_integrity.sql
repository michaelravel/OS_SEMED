-- Integridade relacional dos vínculos e recursos das Ordens de Serviço.
-- Compatibilidade:
--   * referências UUID antigas em details são promovidas somente quando válidas;
--   * registros importados continuam em "A conferir" e só recebem categoria
--     quando a combinação área/natureza/tipo encontra exatamente um catálogo;
--   * duplicidades legadas de chaves de negócio são preservadas, mas novas
--     duplicidades são bloqueadas pelos triggers prospectivos.
begin;

alter table public.os_catalogs
  add constraint os_catalogs_id_kind_key unique(id,kind);

alter table public.os_orders
  add column driver_id uuid,
  add column vehicle_id uuid,
  add column route_id uuid,
  add column requester_membership_id uuid,
  add column responsible_membership_id uuid,
  add column import_source text,
  add column import_source_id text,
  add column category_kind text not null default 'logistics'
    check(category_kind = 'logistics'),
  add column driver_kind text not null default 'drivers'
    check(driver_kind = 'drivers'),
  add column vehicle_kind text not null default 'vehicles'
    check(vehicle_kind = 'vehicles'),
  add column route_kind text not null default 'routes'
    check(route_kind = 'routes'),
  add constraint os_orders_category_domain_fk
    foreign key(category_id,category_kind)
    references public.os_catalogs(id,kind) on delete restrict not valid,
  add constraint os_orders_driver_domain_fk
    foreign key(driver_id,driver_kind)
    references public.os_catalogs(id,kind) on delete restrict,
  add constraint os_orders_vehicle_domain_fk
    foreign key(vehicle_id,vehicle_kind)
    references public.os_catalogs(id,kind) on delete restrict,
  add constraint os_orders_route_domain_fk
    foreign key(route_id,route_kind)
    references public.os_catalogs(id,kind) on delete restrict,
  add constraint os_orders_requester_membership_fk
    foreign key(requester_membership_id)
    references public.os_memberships(id) on delete restrict,
  add constraint os_orders_responsible_membership_fk
    foreign key(responsible_membership_id)
    references public.os_memberships(id) on delete restrict,
  add constraint os_orders_import_record_pair_check check(
    (import_source is null) = (import_source_id is null)
  ),
  add constraint os_orders_import_record_fk
    foreign key(import_source,import_source_id)
    references public.os_import_records(source,source_id) on delete restrict;

create index os_orders_driver on public.os_orders(driver_id) where driver_id is not null;
create index os_orders_vehicle on public.os_orders(vehicle_id) where vehicle_id is not null;
create index os_orders_route on public.os_orders(route_id) where route_id is not null;
create index os_orders_requester_membership on public.os_orders(requester_membership_id)
  where requester_membership_id is not null;
create index os_orders_responsible_membership on public.os_orders(responsible_membership_id)
  where responsible_membership_id is not null;
create unique index os_orders_import_record_unique
  on public.os_orders(import_source,import_source_id)
  where import_source is not null;

-- Índices de busca para as chaves de negócio. Não são UNIQUE porque a fonte
-- contém placas duplicadas e o banco remoto deve ser conciliado antes disso.
create index os_catalogs_driver_code on public.os_catalogs(
  lower(btrim(data ->> 'driverId'))
) where kind = 'drivers' and nullif(btrim(data ->> 'driverId'),'') is not null;
create index os_catalogs_vehicle_plate on public.os_catalogs(
  lower(btrim(data ->> 'plate'))
) where kind = 'vehicles' and nullif(btrim(data ->> 'plate'),'') is not null;
create index os_catalogs_route_code on public.os_catalogs(
  lower(btrim(data ->> 'routeId'))
) where kind = 'routes' and nullif(btrim(data ->> 'routeId'),'') is not null;
create index os_units_normalized_name on public.os_units(lower(btrim(name)));

-- Promove referências usadas pela versão anterior da aplicação. Valores
-- inválidos permanecem em details para conciliação, sem inventar vínculos.
update public.os_orders o set driver_id = c.id
from public.os_catalogs c
where o.driver_id is null and c.kind = 'drivers'
  and c.id::text = o.details ->> 'driver';
update public.os_orders o set vehicle_id = c.id
from public.os_catalogs c
where o.vehicle_id is null and c.kind = 'vehicles'
  and c.id::text = o.details ->> 'vehicle';
update public.os_orders o set route_id = c.id
from public.os_catalogs c
where o.route_id is null and c.kind = 'routes'
  and c.id::text = o.details ->> 'route';

update public.os_orders set details = details - 'driver'
where driver_id is not null and details ? 'driver';
update public.os_orders set details = details - 'vehicle'
where vehicle_id is not null and details ? 'vehicle';
update public.os_orders set details = details - 'route'
where route_id is not null and details ? 'route';

-- Relaciona a linha operacional ao arquivo imutável de origem, quando ele já
-- existe. legacy_id isolado é mantido por compatibilidade com integrações.
update public.os_orders o set
  import_source = 'seed/ABERTURA_OS',
  import_source_id = o.legacy_id
where o.legacy_id is not null and o.import_source is null and exists(
  select 1 from public.os_import_records r
  where r.source = 'seed/ABERTURA_OS' and r.source_id = o.legacy_id
);

-- Backfill conservador: exatamente um catálogo deve coincidir com os três
-- níveis preenchidos da classificação importada.
with category_matches as (
  select o.id, (array_agg(c.id order by c.id))[1] as category_id
  from public.os_orders o
  join public.os_import_records r
    on r.source = o.import_source and r.source_id = o.import_source_id
  join public.os_catalogs c on c.kind = 'logistics'
    and lower(btrim(c.data ->> 'area')) =
        lower(btrim(r.payload ->> 'ÁREA DE SOLICITAÇÃO'))
    and lower(btrim(c.data ->> 'nature')) =
        lower(btrim(r.payload ->> 'NATUREZA DA ATIVIDADE'))
    and lower(btrim(c.data ->> 'type')) =
        lower(btrim(r.payload ->> 'TIPO DE ATIVIDADE'))
  where o.category_id is null
    and nullif(btrim(r.payload ->> 'ÁREA DE SOLICITAÇÃO'),'') is not null
    and nullif(btrim(r.payload ->> 'NATUREZA DA ATIVIDADE'),'') is not null
    and nullif(btrim(r.payload ->> 'TIPO DE ATIVIDADE'),'') is not null
  group by o.id
  having count(*) = 1
)
update public.os_orders o set category_id = m.category_id
from category_matches m where m.id = o.id;

-- Vincula as identidades ao vínculo funcional exato. Preferimos o papel da
-- unidade ao papel global de administrador quando ambos forem válidos.
update public.os_orders o set requester_membership_id = (
  select m.id from public.os_memberships m
  where m.user_id = o.opened_by and (
    (m.role = 'solicitante' and m.unit_id = o.unit_id) or
    (m.role = 'admin' and m.unit_id is null)
  )
  order by case when m.role = 'solicitante' then 0 else 1 end, m.active desc, m.id
  limit 1
)
where o.opened_by is not null and o.requester_membership_id is null;

update public.os_orders o set responsible_membership_id = (
  select m.id from public.os_memberships m
  where m.user_id = o.responsible_id and m.unit_id = o.unit_id
    and m.role = 'responsavel'
  order by m.active desc, m.id limit 1
)
where o.responsible_id is not null and o.responsible_membership_id is null;

create function os_private.enforce_catalog_business_key()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  business_key text;
  previous_key text;
begin
  business_key := lower(btrim(case new.kind
    when 'drivers' then new.data ->> 'driverId'
    when 'vehicles' then new.data ->> 'plate'
    when 'routes' then new.data ->> 'routeId'
    else null end));
  if tg_op = 'UPDATE' then
    previous_key := lower(btrim(case old.kind
      when 'drivers' then old.data ->> 'driverId'
      when 'vehicles' then old.data ->> 'plate'
      when 'routes' then old.data ->> 'routeId'
      else null end));
  end if;
  if nullif(business_key,'') is not null and
     (tg_op <> 'INSERT' or new.legacy_id like 'NEW-%') and
     (tg_op = 'INSERT' or new.kind is distinct from old.kind or
      business_key is distinct from previous_key) and exists(
       select 1 from public.os_catalogs c
       where c.id <> new.id and c.kind = new.kind and lower(btrim(case c.kind
         when 'drivers' then c.data ->> 'driverId'
         when 'vehicles' then c.data ->> 'plate'
         when 'routes' then c.data ->> 'routeId'
         else null end)) = business_key
     ) then raise exception 'Identificador de catálogo já cadastrado';
  end if;
  return new;
end;
$$;
create trigger catalogs_business_key_integrity
  before insert or update of kind,data on public.os_catalogs
  for each row execute function os_private.enforce_catalog_business_key();

create function os_private.enforce_unit_name_key()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op <> 'INSERT' or new.legacy_id is null) and
    (tg_op = 'INSERT' or lower(btrim(new.name)) is distinct from lower(btrim(old.name)))
    and exists(
      select 1 from public.os_units u
      where u.id <> new.id and lower(btrim(u.name)) = lower(btrim(new.name))
    ) then raise exception 'Nome de unidade já cadastrado';
  end if;
  return new;
end;
$$;
create trigger units_name_integrity
  before insert or update of name on public.os_units
  for each row execute function os_private.enforce_unit_name_key();

create function os_private.protect_order_memberships()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(
    select 1 from public.os_orders o
    where o.requester_membership_id = old.id and not (
      new.user_id = o.opened_by and (
        (new.role = 'solicitante' and new.unit_id = o.unit_id) or
        (new.role = 'admin' and new.unit_id is null)
      )
    )
  ) then raise exception 'Vínculo de solicitante referenciado por ordem'; end if;
  if exists(
    select 1 from public.os_orders o
    where o.responsible_membership_id = old.id and not (
      new.user_id = o.responsible_id and new.role = 'responsavel'
      and new.unit_id = o.unit_id
    )
  ) then raise exception 'Vínculo de responsável referenciado por ordem'; end if;
  return new;
end;
$$;
create trigger memberships_order_integrity
  before update of user_id,unit_id,role on public.os_memberships
  for each row execute function os_private.protect_order_memberships();

create or replace function os_private.validate_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Compatibilidade com a aplicação anterior: promove UUIDs válidos de details.
  if new.driver_id is null and coalesce(new.details ->> 'driver','') <> '' then
    select c.id into new.driver_id from public.os_catalogs c
    where c.id::text = new.details ->> 'driver' and c.kind = 'drivers';
    if not found then raise exception 'Referência de catálogo inválida: driver'; end if;
  end if;
  if new.vehicle_id is null and coalesce(new.details ->> 'vehicle','') <> '' then
    select c.id into new.vehicle_id from public.os_catalogs c
    where c.id::text = new.details ->> 'vehicle' and c.kind = 'vehicles';
    if not found then raise exception 'Referência de catálogo inválida: vehicle'; end if;
  end if;
  if new.route_id is null and coalesce(new.details ->> 'route','') <> '' then
    select c.id into new.route_id from public.os_catalogs c
    where c.id::text = new.details ->> 'route' and c.kind = 'routes';
    if not found then raise exception 'Referência de catálogo inválida: route'; end if;
  end if;
  if new.driver_id is not null then new.details := new.details - 'driver'; end if;
  if new.vehicle_id is not null then new.details := new.details - 'vehicle'; end if;
  if new.route_id is not null then new.details := new.details - 'route'; end if;

  if new.opened_by is null then
    new.requester_membership_id := null;
  elsif new.requester_membership_id is null then
    select m.id into new.requester_membership_id
    from public.os_memberships m where m.user_id = new.opened_by and (
      (m.role = 'solicitante' and m.unit_id = new.unit_id) or
      (m.role = 'admin' and m.unit_id is null)
    ) order by case when m.role = 'solicitante' then 0 else 1 end,
      m.active desc, m.id limit 1;
  end if;
  if new.opened_by is not null and not exists(
    select 1 from public.os_memberships m
    where m.id = new.requester_membership_id and m.user_id = new.opened_by and (
      (m.role = 'solicitante' and m.unit_id = new.unit_id) or
      (m.role = 'admin' and m.unit_id is null)
    )
  ) then raise exception 'Solicitante sem vínculo verificável'; end if;

  if new.responsible_id is null then
    new.responsible_membership_id := null;
  elsif new.responsible_membership_id is null then
    select m.id into new.responsible_membership_id
    from public.os_memberships m
    where m.user_id = new.responsible_id and m.unit_id = new.unit_id
      and m.role = 'responsavel'
    order by m.active desc, m.id limit 1;
  end if;
  if new.responsible_id is not null and not exists(
    select 1 from public.os_memberships m
    where m.id = new.responsible_membership_id
      and m.user_id = new.responsible_id and m.unit_id = new.unit_id
      and m.role = 'responsavel'
  ) then raise exception 'Responsável sem vínculo verificável'; end if;

  if auth.uid() is not null then
    if new.unit_id is null or not exists(
      select 1 from public.os_units where id = new.unit_id and active
    ) then raise exception 'Unidade inválida'; end if;
    if new.category_id is not null and not exists(
      select 1 from public.os_catalogs
      where id = new.category_id and kind = 'logistics' and active
    ) then raise exception 'Classificação inválida'; end if;
    if new.responsible_id is not null and not exists(
      select 1 from public.os_memberships where id = new.responsible_membership_id
        and active
    ) then raise exception 'Responsável sem vínculo ativo'; end if;
    if new.opened_by is not null and not exists(
      select 1 from public.os_memberships where id = new.requester_membership_id
        and active
    ) then raise exception 'Solicitante sem vínculo ativo'; end if;
    if new.driver_id is not null and not exists(
      select 1 from public.os_catalogs where id = new.driver_id and kind = 'drivers' and active
    ) then raise exception 'Motorista inválido'; end if;
    if new.vehicle_id is not null and not exists(
      select 1 from public.os_catalogs where id = new.vehicle_id and kind = 'vehicles' and active
    ) then raise exception 'Veículo inválido'; end if;
    if new.route_id is not null and not exists(
      select 1 from public.os_catalogs where id = new.route_id and kind = 'routes' and active
    ) then raise exception 'Rota inválida'; end if;
  end if;

  if new.status <> 'A conferir' and (
    new.opened_by is null or new.category_id is null
  ) then raise exception 'Conciliação obrigatória antes de avançar a ordem'; end if;
  if new.status in (
    'Em execução','Aguardando material',
    'Aguardando deslocamento/logística','Concluída'
  ) and new.responsible_id is null then
    raise exception 'Responsável obrigatório para atendimento';
  end if;

  if tg_op = 'INSERT' then
    new.created_at = coalesce(new.created_at,now());
    new.opened_at = coalesce(new.opened_at,now());
  end if;
  new.updated_at = now();
  return new;
end;
$$;

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
          select 1 from public.os_orders o
          where o.unit_id = m.unit_id
            and (m.role = 'gestor' or o.responsible_id = m.user_id)
            and c.id in (o.category_id,o.driver_id,o.vehicle_id,o.route_id)
        ))
      )
    )
  );
$$;

create or replace function public.os_assign_order(
  target uuid,
  target_unit uuid,
  target_responsible uuid,
  target_opened_by uuid,
  target_category uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  requester_membership uuid;
  responsible_membership uuid;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if target_opened_by is not null then
    select m.id into requester_membership from public.os_memberships m
    where m.user_id = target_opened_by and m.active and (
      (m.role = 'solicitante' and m.unit_id = target_unit) or
      (m.role = 'admin' and m.unit_id is null)
    ) order by case when m.role = 'solicitante' then 0 else 1 end, m.id limit 1;
    if requester_membership is null then raise exception 'Solicitante sem vínculo ativo'; end if;
  end if;
  if target_responsible is not null then
    select m.id into responsible_membership from public.os_memberships m
    where m.user_id = target_responsible and m.unit_id = target_unit
      and m.role = 'responsavel' and m.active limit 1;
    if responsible_membership is null then raise exception 'Responsável sem vínculo ativo'; end if;
  end if;
  if not exists(
    select 1 from public.os_catalogs c
    where c.id = target_category and c.kind = 'logistics' and c.active
  ) then raise exception 'Classificação inválida'; end if;
  if not exists(
    select 1 from public.os_units u where u.id = target_unit and u.active
  ) then raise exception 'Unidade inválida'; end if;

  update public.os_orders set
    unit_id = target_unit,
    responsible_id = target_responsible,
    responsible_membership_id = responsible_membership,
    opened_by = target_opened_by,
    requester_membership_id = requester_membership,
    category_id = target_category
  where id = target and active;
  if not found then raise exception 'Ordem não encontrada'; end if;
end;
$$;

revoke all on function os_private.enforce_catalog_business_key() from public,anon,authenticated;
revoke all on function os_private.enforce_unit_name_key() from public,anon,authenticated;
revoke all on function os_private.protect_order_memberships() from public,anon,authenticated;

commit;
