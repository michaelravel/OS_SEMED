-- Integração final do RBAC com os controles administrativos da aplicação.
begin;

-- Perfil somente leitura real, configurável pela matriz e compatível com o
-- papel solicitante durante a transição do modelo legado.
insert into public.os_access_profiles(
  id,key,name,description,active,is_system,legacy_role
) values(
  'a1000000-0000-4000-a000-000000000005',
  'viewer','Consulta',
  'Consulta dados autorizados pelo escopo, sem executar alterações.',
  true,false,'solicitante'
) on conflict(key) do nothing;

insert into public.os_access_profile_permissions(
  access_profile_id,permission_id
)
select profile.id,permission.id
from public.os_access_profiles profile
join public.os_permissions permission on permission.key=any(array[
  'dashboard.view','orders.view','units.view','logistics.view',
  'routes.view','vehicles.view','drivers.view'
]::text[])
where profile.key='viewer'
on conflict do nothing;

-- Exclusão lógica específica. Não aceita campos editáveis, preserva o
-- histórico e não permite usar a permissão delete como update genérico.
create function public.os_deactivate_professional_membership(
  target_membership uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare current_membership public.os_memberships%rowtype;
begin
  perform os_private.require_permission('professionals.delete');
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  perform pg_advisory_xact_lock(240920260001);

  select * into current_membership
  from public.os_memberships
  where id=target_membership
  for update;
  if not found then raise exception 'Vínculo não encontrado'; end if;
  if current_membership.role='admin' then
    perform os_private.require_permission('professionals.manage');
  end if;
  if not current_membership.active then return; end if;

  update public.os_memberships
  set active=false
  where id=target_membership;
end;
$$;

revoke all on function public.os_deactivate_professional_membership(uuid)
  from public,anon;
grant execute on function public.os_deactivate_professional_membership(uuid)
  to authenticated;

commit;
