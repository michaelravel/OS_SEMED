-- Rollback local. Antes de usar, confirme que nenhum vínculo novo depende de
-- professional_id e preserve uma exportação de os_professionals/os_identity_events.
begin;
do $$ begin
  if exists(select 1 from public.os_memberships where user_id is null) then
    raise exception 'Rollback bloqueado: há profissionais sem identidade vinculada';
  end if;
end $$;
drop function if exists public.os_restore_professional_identity(uuid,text);
drop function if exists public.os_prepare_professional_identity_change(uuid,text,text);
drop function if exists public.os_save_professional_membership(uuid,uuid,text,text,text,text,uuid,text,boolean,boolean);
drop function if exists public.os_professional_memberships(integer,integer);
drop function if exists public.os_record_identity_denial(text,text);
drop function if exists public.os_claim_professional_identity();
drop trigger if exists identity_events_immutable on public.os_identity_events;
drop function if exists os_private.prevent_identity_event_mutation();
drop table if exists public.os_identity_events;
drop trigger if exists memberships_attach_professional on public.os_memberships;
drop function if exists os_private.attach_membership_professional();
drop index if exists public.os_memberships_professional_role_unique;
drop index if exists public.os_memberships_professional_id;
alter table public.os_memberships drop column if exists professional_id;
drop index if exists public.os_memberships_auth_role_unique;
alter table public.os_memberships alter column user_id set not null;
alter table public.os_memberships
  add constraint os_memberships_user_id_unit_id_role_key
  unique nulls not distinct(user_id,unit_id,role);
drop table if exists public.os_professionals;
commit;
