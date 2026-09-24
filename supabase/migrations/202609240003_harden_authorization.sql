-- Fortalecimento incremental de autorização administrativa e catálogos.
-- Estado anterior documentado:
--   * catalogs_read: qualquer vínculo ativo lia todos os catálogos ativos;
--     administradores também liam inativos.
--   * units_admin, profiles_admin, memberships_admin e catalogs_admin eram
--     policies FOR ALL; os grants permitiam INSERT/UPDATE direto nessas tabelas.
--   * ensure_admin_remaining protegia o último admin, mas as alterações de papel
--     ainda passavam pela operação genérica de vínculos.
-- Estado novo:
--   * solicitantes e gestores globais mantêm leitura dos catálogos ativos;
--     gestores de unidade e responsáveis veem somente catálogos referenciados
--     por ordens que podem acompanhar; administradores mantêm leitura total.
--   * escrita administrativa direta é revogada e substituída por RPCs específicas.
--   * concessão, revogação e reclassificação de admin são operações distintas.
begin;

create function os_private.can_read_catalog(c public.os_catalogs)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.is_admin() or (
    c.active and exists(
      select 1
      from public.os_memberships m
      where m.user_id = (select auth.uid())
        and m.active
        and (
          (
            m.role = 'solicitante' and exists(
              select 1 from public.os_units u
              where u.id = m.unit_id and u.active
            )
          ) or
          (m.role = 'gestor' and m.unit_id is null) or
          (
            m.role in ('gestor','responsavel') and
            exists(
              select 1
              from public.os_orders o
              where o.unit_id = m.unit_id
                and (
                  m.role = 'gestor' or o.responsible_id = m.user_id
                )
                and (
                  o.category_id = c.id or
                  o.details ->> 'driver' = c.id::text or
                  o.details ->> 'vehicle' = c.id::text or
                  o.details ->> 'route' = c.id::text
                )
            )
          )
        )
    )
  );
$$;

drop policy catalogs_read on public.os_catalogs;
create policy catalogs_read on public.os_catalogs for select to authenticated
  using(os_private.can_read_catalog(os_catalogs));

-- Leitura administrativa já está coberta pelas policies *_read.
drop policy units_admin on public.os_units;
drop policy profiles_admin on public.os_profiles;
drop policy memberships_admin on public.os_memberships;
drop policy catalogs_admin on public.os_catalogs;

revoke insert, update, delete on public.os_units from authenticated;
revoke insert, update, delete on public.os_profiles from authenticated;
revoke insert, update, delete on public.os_memberships from authenticated;
revoke insert, update, delete on public.os_catalogs from authenticated;

create or replace function os_private.ensure_admin_remaining()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.unit_id is null and old.active and (
    tg_op = 'DELETE' or new.role <> 'admin' or new.unit_id is not null or not new.active
  ) then
    perform pg_advisory_xact_lock(240920260001);
    if not exists(
      select 1 from public.os_memberships m
      where m.id <> old.id and m.role = 'admin' and m.unit_id is null and m.active
    ) then
      raise exception 'Não é permitido remover o último administrador ativo';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.os_save_unit(
  target uuid,
  unit_name text,
  unit_type text,
  unit_address text,
  unit_coordinates text,
  unit_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_id uuid;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if length(trim(coalesce(unit_name,''))) not between 1 and 300 or
     length(coalesce(unit_type,'')) > 200 or
     length(coalesce(unit_address,'')) > 1000 or
     length(coalesce(unit_coordinates,'')) > 100 or
     unit_active is null then raise exception 'Unidade inválida'; end if;

  if target is null then
    insert into public.os_units(name,type,address,coordinates,active)
    values(trim(unit_name),unit_type,unit_address,unit_coordinates,unit_active)
    returning id into saved_id;
  else
    update public.os_units set
      name = trim(unit_name), type = unit_type, address = unit_address,
      coordinates = unit_coordinates, active = unit_active
    where id = target returning id into saved_id;
    if not found then raise exception 'Unidade não encontrada'; end if;
  end if;
  return saved_id;
end;
$$;

create function public.os_save_catalog(
  target uuid,
  catalog_kind text,
  catalog_name text,
  catalog_data jsonb,
  catalog_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_id uuid;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if catalog_kind not in ('logistics','routes','vehicles','drivers') or
     length(trim(coalesce(catalog_name,''))) not between 1 and 500 or
     jsonb_typeof(catalog_data) <> 'object' or catalog_active is null then
    raise exception 'Catálogo inválido';
  end if;
  if exists(
    select 1 from jsonb_each(catalog_data) item where jsonb_typeof(item.value) <> 'string'
  ) then raise exception 'Dados de catálogo inválidos'; end if;
  if exists(
    select 1 from jsonb_object_keys(catalog_data) key
    where not case catalog_kind
      when 'logistics' then key in ('area','nature','type','description','detail','options','reminder')
      when 'routes' then key in ('routeId','number','link')
      when 'vehicles' then key in ('plate','model','seats')
      when 'drivers' then key in ('driverId')
      else false
    end
  ) then raise exception 'Campo de catálogo não permitido'; end if;
  if catalog_kind = 'routes' and coalesce(catalog_data ->> 'link','') <> '' and
     catalog_data ->> 'link' !~ '^https?://' then
    raise exception 'Link de rota inválido';
  end if;

  if target is null then
    insert into public.os_catalogs(legacy_id,kind,name,data,active)
    values('NEW-' || gen_random_uuid()::text,catalog_kind,trim(catalog_name),catalog_data,catalog_active)
    returning id into saved_id;
  else
    update public.os_catalogs set
      name = trim(catalog_name), data = catalog_data, active = catalog_active
    where id = target and kind = catalog_kind returning id into saved_id;
    if not found then raise exception 'Catálogo não encontrado'; end if;
  end if;
  return saved_id;
end;
$$;

create function public.os_save_membership(
  target uuid,
  target_user uuid,
  target_unit uuid,
  target_role text,
  target_active boolean,
  target_name text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_member public.os_memberships%rowtype;
  saved_id uuid;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if target_role not in ('gestor','solicitante','responsavel') or
     length(trim(coalesce(target_name,''))) not between 1 and 200 or
     target_active is null then raise exception 'Vínculo inválido'; end if;
  if target_role in ('solicitante','responsavel') and target_unit is null then
    raise exception 'Unidade obrigatória para o papel';
  end if;
  if target_unit is not null and not exists(
    select 1 from public.os_units u where u.id = target_unit and u.active
  ) then raise exception 'Unidade inválida'; end if;

  if target is not null then
    select * into current_member from public.os_memberships where id = target for update;
    if not found then raise exception 'Vínculo não encontrado'; end if;
    if current_member.role = 'admin' then
      raise exception 'Use a operação explícita de reclassificação de administrador';
    end if;
    if current_member.user_id <> target_user then
      raise exception 'A identidade do vínculo não pode ser alterada';
    end if;
  end if;

  insert into public.os_profiles(id,name) values(target_user,trim(target_name))
  on conflict(id) do update set name = excluded.name;

  if target is null then
    insert into public.os_memberships(user_id,unit_id,role,active)
    values(target_user,target_unit,target_role,target_active)
    returning id into saved_id;
  else
    update public.os_memberships set
      unit_id = target_unit, role = target_role, active = target_active
    where id = target returning id into saved_id;
  end if;
  return saved_id;
end;
$$;

create function public.os_grant_admin(
  target_user uuid,
  target_name text,
  replaced_membership uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_member public.os_memberships%rowtype;
  saved_id uuid;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if length(trim(coalesce(target_name,''))) not between 1 and 200 then
    raise exception 'Nome inválido';
  end if;
  perform pg_advisory_xact_lock(240920260001);

  if replaced_membership is not null then
    select * into current_member from public.os_memberships
    where id = replaced_membership for update;
    if not found or current_member.user_id <> target_user then
      raise exception 'Vínculo de origem inválido';
    end if;
    if current_member.role <> 'admin' then
      update public.os_memberships set active = false where id = current_member.id;
    end if;
  end if;

  insert into public.os_profiles(id,name) values(target_user,trim(target_name))
  on conflict(id) do update set name = excluded.name;
  insert into public.os_memberships(user_id,unit_id,role,active)
  values(target_user,null,'admin',true)
  on conflict(user_id,unit_id,role) do update set active = true
  returning id into saved_id;
  return saved_id;
end;
$$;

create function public.os_revoke_admin(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_member public.os_memberships%rowtype;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  perform pg_advisory_xact_lock(240920260001);
  select * into current_member from public.os_memberships
  where id = target and role = 'admin' and unit_id is null and active for update;
  if not found then raise exception 'Administrador ativo não encontrado'; end if;
  if current_member.user_id = auth.uid() then
    raise exception 'Não é permitido remover o próprio papel administrativo';
  end if;
  update public.os_memberships set active = false where id = target;
end;
$$;

create function public.os_reclassify_admin(
  target uuid,
  target_unit uuid,
  target_role text,
  target_active boolean,
  target_name text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_member public.os_memberships%rowtype;
begin
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if target_role not in ('gestor','solicitante','responsavel') or
     length(trim(coalesce(target_name,''))) not between 1 and 200 or
     target_active is null then raise exception 'Reclassificação inválida'; end if;
  if target_role in ('solicitante','responsavel') and target_unit is null then
    raise exception 'Unidade obrigatória para o papel';
  end if;
  if target_unit is not null and not exists(
    select 1 from public.os_units u where u.id = target_unit and u.active
  ) then raise exception 'Unidade inválida'; end if;

  perform pg_advisory_xact_lock(240920260001);
  select * into current_member from public.os_memberships
  where id = target and role = 'admin' and unit_id is null for update;
  if not found then raise exception 'Administrador não encontrado'; end if;
  if current_member.user_id = auth.uid() then
    raise exception 'Não é permitido reclassificar o próprio administrador';
  end if;

  update public.os_profiles set name = trim(target_name)
  where id = current_member.user_id;
  update public.os_memberships set
    unit_id = target_unit, role = target_role, active = target_active
  where id = target;
end;
$$;

revoke all on function os_private.can_read_catalog(public.os_catalogs) from public, anon;
revoke all on function public.os_save_unit(uuid,text,text,text,text,boolean) from public, anon;
revoke all on function public.os_save_catalog(uuid,text,text,jsonb,boolean) from public, anon;
revoke all on function public.os_save_membership(uuid,uuid,uuid,text,boolean,text) from public, anon;
revoke all on function public.os_grant_admin(uuid,text,uuid) from public, anon;
revoke all on function public.os_revoke_admin(uuid) from public, anon;
revoke all on function public.os_reclassify_admin(uuid,uuid,text,boolean,text) from public, anon;
grant execute on function public.os_save_unit(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.os_save_catalog(uuid,text,text,jsonb,boolean) to authenticated;
grant execute on function public.os_save_membership(uuid,uuid,uuid,text,boolean,text) to authenticated;
grant execute on function public.os_grant_admin(uuid,text,uuid) to authenticated;
grant execute on function public.os_revoke_admin(uuid) to authenticated;
grant execute on function public.os_reclassify_admin(uuid,uuid,text,boolean,text) to authenticated;
grant execute on function os_private.can_read_catalog(public.os_catalogs) to authenticated;

commit;
