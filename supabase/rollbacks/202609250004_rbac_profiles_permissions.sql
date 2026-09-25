-- Rollback somente antes de o RBAC se tornar a autoridade e antes de cadastrar
-- perfis configuráveis. O papel legado é preservado em os_memberships.role.
begin;

do $$
begin
  if exists(select 1 from public.os_access_profiles where not is_system) then
    raise exception 'Rollback bloqueado: existem perfis de acesso configuráveis';
  end if;
end;
$$;

drop trigger if exists memberships_sync_access_profile on public.os_memberships;
drop function if exists os_private.sync_membership_access_profile();
drop index if exists public.os_memberships_access_profile;
alter table public.os_memberships
  drop constraint if exists os_memberships_access_profile_fk,
  drop column if exists access_profile_id;

drop table if exists public.os_access_profile_permissions;
drop table if exists public.os_permissions;
drop trigger if exists access_profiles_updated_at on public.os_access_profiles;
drop function if exists os_private.touch_access_profile_updated_at();
drop table if exists public.os_access_profiles;

commit;
