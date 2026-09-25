-- Operações administrativas específicas para perfis e permissões.
-- Escrita direta nas tabelas RBAC continua revogada.
begin;

create function public.os_save_access_profile(
  target uuid,
  profile_name text,
  profile_description text,
  profile_active boolean,
  profile_legacy_role text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_profile public.os_access_profiles%rowtype;
  saved_profile public.os_access_profiles%rowtype;
begin
  perform os_private.require_permission('professionals.manage');
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  -- Serializa mudanças de perfis com alterações de vínculos administrativos.
  perform pg_advisory_xact_lock(240920260001);
  if length(btrim(coalesce(profile_name,''))) not between 1 and 120 or
     length(coalesce(profile_description,'')) > 1000 or
     profile_active is null or
     profile_legacy_role not in ('admin','gestor','solicitante','responsavel') then
    raise exception 'Perfil inválido';
  end if;

  if target is null then
    insert into public.os_access_profiles(
      key,name,description,active,is_system,legacy_role
    ) values(
      'custom_' || replace(gen_random_uuid()::text,'-',''),
      btrim(profile_name),btrim(coalesce(profile_description,'')),
      profile_active,false,profile_legacy_role
    ) returning * into saved_profile;
    insert into public.os_audit(actor,entity,record_id,action,after_data)
    values(auth.uid(),'os_access_profiles',saved_profile.id::text,'INSERT',
      to_jsonb(saved_profile));
    return saved_profile.id;
  end if;

  select * into current_profile
  from public.os_access_profiles where id=target for update;
  if not found then raise exception 'Perfil não encontrado'; end if;
  if current_profile.is_system and (
    not profile_active or profile_legacy_role<>current_profile.legacy_role
  ) then
    raise exception 'Perfil de sistema deve permanecer ativo e compatível';
  end if;
  if current_profile.legacy_role<>profile_legacy_role and exists(
    select 1 from public.os_memberships m where m.access_profile_id=target
  ) then
    raise exception 'Perfil em uso não pode mudar o papel compatível';
  end if;
  if not profile_active and exists(
    select 1 from public.os_memberships m
    where m.access_profile_id=target and m.active and m.role='admin'
  ) then
    raise exception 'Perfil de administrador ativo não pode ser desativado';
  end if;

  update public.os_access_profiles set
    name=btrim(profile_name),
    description=btrim(coalesce(profile_description,'')),
    active=profile_active,
    legacy_role=profile_legacy_role
  where id=target returning * into saved_profile;
  insert into public.os_audit(
    actor,entity,record_id,action,before_data,after_data
  ) values(
    auth.uid(),'os_access_profiles',target::text,'UPDATE',
    to_jsonb(current_profile),to_jsonb(saved_profile)
  );
  return target;
end;
$$;

create function public.os_set_access_profile_permissions(
  target uuid,
  permission_keys text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_profile public.os_access_profiles%rowtype;
  requested_keys text[] := coalesce(permission_keys,'{}'::text[]);
  previous_keys text[];
  added_keys text[];
  removed_keys text[];
begin
  perform os_private.require_permission('professionals.manage');
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  -- Usa o mesmo lock da proteção do último administrador.
  perform pg_advisory_xact_lock(240920260001);
  select * into current_profile
  from public.os_access_profiles where id=target for update;
  if not found then raise exception 'Perfil não encontrado'; end if;
  if cardinality(requested_keys) <> (
    select count(distinct requested.key)
    from unnest(requested_keys) as requested(key)
  ) then raise exception 'Permissões duplicadas'; end if;
  if exists(
    select 1 from unnest(requested_keys) requested(key)
    left join public.os_permissions permission on permission.key=requested.key
    where permission.id is null
  ) then raise exception 'Permissão inválida'; end if;
  if (
    current_profile.key='admin' or exists(
      select 1 from public.os_memberships m
      where m.access_profile_id=target and m.active and m.role='admin'
    )
  ) and not (
    'professionals.view'=any(requested_keys) and
    'professionals.manage'=any(requested_keys)
  ) then
    raise exception 'Perfil administrativo deve manter as permissões essenciais';
  end if;

  select coalesce(array_agg(permission.key order by permission.key),'{}'::text[])
  into previous_keys
  from public.os_access_profile_permissions assignment
  join public.os_permissions permission on permission.id=assignment.permission_id
  where assignment.access_profile_id=target;

  select coalesce(array_agg(delta.key order by delta.key),'{}'::text[])
  into added_keys
  from (
    select unnest(requested_keys) as key
    except
    select unnest(previous_keys) as key
  ) delta;
  select coalesce(array_agg(delta.key order by delta.key),'{}'::text[])
  into removed_keys
  from (
    select unnest(previous_keys) as key
    except
    select unnest(requested_keys) as key
  ) delta;

  delete from public.os_access_profile_permissions
  where access_profile_id=target;
  insert into public.os_access_profile_permissions(
    access_profile_id,permission_id
  )
  select target,permission.id
  from public.os_permissions permission
  where permission.key=any(requested_keys);

  insert into public.os_audit(
    actor,entity,record_id,action,before_data,after_data
  ) values(
    auth.uid(),'os_access_profile_permissions',target::text,'REPLACE',
    jsonb_build_object(
      'profile_key',current_profile.key,
      'profile_name',current_profile.name,
      'permissions',previous_keys
    ),
    jsonb_build_object(
      'profile_key',current_profile.key,
      'profile_name',current_profile.name,
      'permissions',requested_keys,
      'added',added_keys,
      'removed',removed_keys
    )
  );
end;
$$;

create function public.os_delete_access_profile(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_profile public.os_access_profiles%rowtype;
begin
  perform os_private.require_permission('professionals.manage');
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  select * into current_profile
  from public.os_access_profiles where id=target for update;
  if not found then raise exception 'Perfil não encontrado'; end if;
  if current_profile.is_system then
    raise exception 'Perfil de sistema não pode ser excluído';
  end if;
  if exists(
    select 1 from public.os_memberships m where m.access_profile_id=target
  ) then raise exception 'Perfil em uso não pode ser excluído'; end if;
  delete from public.os_access_profiles where id=target;
  insert into public.os_audit(actor,entity,record_id,action,before_data)
  values(auth.uid(),'os_access_profiles',target::text,'DELETE',
    to_jsonb(current_profile));
end;
$$;

revoke all on function public.os_save_access_profile(uuid,text,text,boolean,text)
  from public,anon;
revoke all on function public.os_set_access_profile_permissions(uuid,text[])
  from public,anon;
revoke all on function public.os_delete_access_profile(uuid)
  from public,anon;
grant execute on function public.os_save_access_profile(uuid,text,text,boolean,text)
  to authenticated;
grant execute on function public.os_set_access_profile_permissions(uuid,text[])
  to authenticated;
grant execute on function public.os_delete_access_profile(uuid)
  to authenticated;

commit;
