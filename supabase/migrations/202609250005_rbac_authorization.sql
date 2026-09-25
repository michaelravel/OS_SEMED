-- Resolução central de permissões e wrappers de transição.
-- RBAC decide a capacidade; as funções legadas e a RLS preservam escopo,
-- estado, vínculo e demais regras de negócio.
begin;

create function os_private.has_permission(required_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1
    from public.os_memberships membership
    join public.os_professionals professional
      on professional.id=membership.professional_id
     and professional.active
     and professional.auth_user_id=(select auth.uid())
    join public.os_access_profiles profile
      on profile.id=membership.access_profile_id and profile.active
    join public.os_access_profile_permissions assignment
      on assignment.access_profile_id=profile.id
    join public.os_permissions permission
      on permission.id=assignment.permission_id
    where membership.user_id=(select auth.uid())
      and membership.active
      and permission.key=required_permission
  );
$$;

create function os_private.require_permission(required_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not os_private.has_permission(required_permission) then
    raise exception using errcode='42501',message='Acesso negado';
  end if;
end;
$$;

create function public.os_has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission(permission_key);
$$;

create function public.os_current_permissions()
returns table(permission_key text)
language sql stable security definer set search_path = '' as $$
  select distinct permission.key
  from public.os_memberships membership
  join public.os_professionals professional
    on professional.id=membership.professional_id
   and professional.active
   and professional.auth_user_id=(select auth.uid())
  join public.os_access_profiles profile
    on profile.id=membership.access_profile_id and profile.active
  join public.os_access_profile_permissions assignment
    on assignment.access_profile_id=profile.id
  join public.os_permissions permission
    on permission.id=assignment.permission_id
  where auth.uid() is not null
    and membership.user_id=(select auth.uid())
    and membership.active
  order by permission.key;
$$;

-- A capacidade de leitura é combinada com o mesmo escopo de OS já validado.
create or replace function os_private.can_read_order_internal(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission('orders.view') and (
    os_private.is_admin()
    or os_private.is_origin_manager(o)
    or os_private.is_destination_manager(o)
    or os_private.is_assigned_responsible(o)
  );
$$;

create or replace function os_private.can_read_order(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission('orders.view') and (
    os_private.can_read_order_internal(o)
    or os_private.is_order_requester(o)
  );
$$;

create or replace function os_private.can_write_order(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission('orders.view') and exists(
    select 1 from public.os_orders o
    where o.id=target and o.active and o.status not in ('Concluída','Cancelada')
      and (
        os_private.can_read_order_internal(o) or
        os_private.is_order_requester(o)
      )
  );
$$;

create or replace function os_private.can_read_order_event(target uuid,event_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission('orders.view') and exists(
    select 1 from public.os_orders o
    where o.id=target and (
      os_private.can_read_order_internal(o) or (
        os_private.is_order_requester(o) and event_kind in (
          'order_opened','order_reconciled','triage_started','order_forwarded',
          'service_started','information_wait_started','service_resumed',
          'order_completed','order_canceled','order_reopened','attachment_added'
        )
      )
    )
  );
$$;

create or replace function os_private.can_read_attachment(a public.os_attachments)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission('orders.view')
    and a.storage_status='ready' and a.inspection_status <> 'rejected' and exists(
      select 1 from public.os_orders o
      where o.id=a.order_id and (
        os_private.can_read_order_internal(o) or
        (a.service_entry_id is null and os_private.is_order_requester(o))
      )
    );
$$;

create or replace function os_private.can_read_catalog(c public.os_catalogs)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission(c.kind || '.view') and (
    os_private.is_admin() or (
      c.active and exists(
        select 1 from public.os_memberships m
        where m.user_id=(select auth.uid()) and m.active and (
          (m.role='solicitante' and exists(
            select 1 from public.os_units u where u.id=m.unit_id and u.active
          )) or
          (m.role='gestor' and m.unit_id is null) or
          (m.role in ('gestor','responsavel') and exists(
            select 1 from public.os_orders o
            where (
                (m.role='gestor' and m.unit_id in (o.unit_id,o.destination_unit_id)) or
                (m.role='responsavel'
                  and m.unit_id=coalesce(o.destination_unit_id,o.unit_id)
                  and o.responsible_membership_id=m.id)
              )
              and c.id in (o.category_id,o.driver_id,o.vehicle_id,o.route_id)
          ))
        )
      )
    )
  );
$$;

drop policy units_read on public.os_units;
create policy units_read on public.os_units for select to authenticated using(
  os_private.has_permission('units.view') and (
    os_private.is_admin() or exists(
      select 1 from public.os_memberships m
      where m.user_id=(select auth.uid()) and m.active and
        (m.unit_id=os_units.id or (m.unit_id is null and m.role='gestor'))
    )
  )
);

drop policy profiles_read on public.os_profiles;
create policy profiles_read on public.os_profiles for select to authenticated using(
  id=(select auth.uid()) or (
    os_private.has_permission('professionals.view') and os_private.is_admin()
  )
);
drop policy memberships_read on public.os_memberships;
create policy memberships_read on public.os_memberships for select to authenticated using(
  user_id=(select auth.uid()) or (
    os_private.has_permission('professionals.view') and os_private.is_admin()
  )
);
drop policy professionals_read on public.os_professionals;
create policy professionals_read on public.os_professionals for select to authenticated using(
  auth_user_id=(select auth.uid()) or (
    os_private.has_permission('professionals.view') and os_private.is_admin()
  )
);
drop policy audit_read on public.os_audit;
create policy audit_read on public.os_audit for select to authenticated using(
  os_private.has_permission('audit.view') and os_private.is_admin()
);
drop policy access_profiles_admin_read on public.os_access_profiles;
create policy access_profiles_admin_read on public.os_access_profiles
  for select to authenticated using(
    os_private.has_permission('professionals.manage') and os_private.is_admin()
  );
drop policy permissions_admin_read on public.os_permissions;
create policy permissions_admin_read on public.os_permissions
  for select to authenticated using(
    os_private.has_permission('professionals.manage') and os_private.is_admin()
  );
drop policy access_profile_permissions_admin_read
  on public.os_access_profile_permissions;
create policy access_profile_permissions_admin_read
  on public.os_access_profile_permissions for select to authenticated using(
    os_private.has_permission('professionals.manage') and os_private.is_admin()
  );

-- Implementações atuais viram a segunda barreira, interna. Os wrappers públicos
-- acrescentam RBAC sem retirar as validações legadas de papel e escopo.
alter function public.os_open_order(text,uuid,uuid,text,jsonb,uuid,uuid,uuid)
  set schema os_private;
alter function public.os_reconcile_order(uuid,bigint,uuid,uuid,uuid)
  set schema os_private;
alter function public.os_start_triage(uuid,bigint) set schema os_private;
alter function public.os_forward_order(uuid,bigint,uuid) set schema os_private;
alter function public.os_assign_order(uuid,bigint,uuid) set schema os_private;
alter function public.os_reassign_order(uuid,bigint,uuid,text) set schema os_private;
alter function public.os_start_service(uuid,bigint) set schema os_private;
alter function public.os_add_service_entry(uuid,bigint,text,text,timestamptz)
  set schema os_private;
alter function public.os_wait_for_information(uuid,bigint,text,text)
  set schema os_private;
alter function public.os_resume_service(uuid,bigint) set schema os_private;
alter function public.os_complete_order(uuid,bigint,text) set schema os_private;
alter function public.os_cancel_order(uuid,bigint,text) set schema os_private;
alter function public.os_reopen_order(uuid,bigint,text) set schema os_private;
alter function public.os_edit_order_controlled(uuid,bigint,text,text,text,jsonb)
  set schema os_private;

create function public.os_open_order(
  order_title text,target_unit uuid,target_category uuid,order_priority text,
  order_details jsonb,target_driver uuid,target_vehicle uuid,target_route uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.create');
  return os_private.os_open_order(order_title,target_unit,target_category,
    order_priority,order_details,target_driver,target_vehicle,target_route);
end;
$$;
create function public.os_reconcile_order(
  target uuid,expected_version bigint,target_unit uuid,target_opened_by uuid,
  target_category uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.update');
  perform os_private.os_reconcile_order(target,expected_version,target_unit,
    target_opened_by,target_category);
end;
$$;
create function public.os_start_triage(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.triage');
  perform os_private.os_start_triage(target,expected_version);
end;
$$;
create function public.os_forward_order(
  target uuid,expected_version bigint,destination_unit uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.forward');
  perform os_private.os_forward_order(target,expected_version,destination_unit);
end;
$$;
create function public.os_assign_order(
  target uuid,expected_version bigint,responsible_membership uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.assign');
  perform os_private.os_assign_order(target,expected_version,responsible_membership);
end;
$$;
create function public.os_reassign_order(
  target uuid,expected_version bigint,responsible_membership uuid,
  justification text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.reassign');
  perform os_private.os_reassign_order(target,expected_version,
    responsible_membership,justification);
end;
$$;
create function public.os_start_service(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.attend');
  perform os_private.os_start_service(target,expected_version);
end;
$$;
create function public.os_add_service_entry(
  target uuid,expected_version bigint,entry_kind text,entry_description text,
  serviced_on timestamptz
) returns bigint language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.attend');
  return os_private.os_add_service_entry(target,expected_version,entry_kind,
    entry_description,serviced_on);
end;
$$;
create function public.os_wait_for_information(
  target uuid,expected_version bigint,wait_reason text,wait_details text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.wait_information');
  perform os_private.os_wait_for_information(target,expected_version,
    wait_reason,wait_details);
end;
$$;
create function public.os_resume_service(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.resume');
  perform os_private.os_resume_service(target,expected_version);
end;
$$;
create function public.os_complete_order(
  target uuid,expected_version bigint,solution text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.complete');
  perform os_private.os_complete_order(target,expected_version,solution);
end;
$$;
create function public.os_cancel_order(
  target uuid,expected_version bigint,justification text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.cancel');
  perform os_private.os_cancel_order(target,expected_version,justification);
end;
$$;
create function public.os_reopen_order(
  target uuid,expected_version bigint,justification text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.reopen');
  perform os_private.os_reopen_order(target,expected_version,justification);
end;
$$;
create function public.os_edit_order_controlled(
  target uuid,expected_version bigint,new_title text,new_priority text,
  priority_justification text,detail_patch jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.update');
  perform os_private.os_edit_order_controlled(target,expected_version,new_title,
    new_priority,priority_justification,detail_patch);
end;
$$;

-- Compatibilidade com RPCs legadas ainda publicadas.
alter function public.os_change_status(uuid,text,text) set schema os_private;
alter function public.os_assign_order(uuid,uuid,uuid,uuid,uuid) set schema os_private;
alter function public.os_edit_order(uuid,text,text,jsonb) set schema os_private;
alter function public.os_complete_order(uuid,text) set schema os_private;
alter function public.os_cancel_order(uuid,text) set schema os_private;
alter function public.os_reopen_order(uuid,text) set schema os_private;

create function public.os_change_status(
  target uuid,next_status text,reason text default ''
) returns void language plpgsql security definer set search_path = '' as $$
declare required_permission text;
begin
  required_permission:=case next_status
    when 'Em análise' then 'orders.triage'
    when 'Em triagem' then 'orders.triage'
    when 'Em execução' then 'orders.attend'
    when 'Em atendimento' then 'orders.attend'
    when 'Aguardando material' then 'orders.wait_information'
    when 'Aguardando deslocamento/logística' then 'orders.wait_information'
    when 'Aguardando informação' then 'orders.wait_information'
    when 'Concluída' then 'orders.complete'
    when 'Cancelada' then 'orders.cancel'
    when 'Aberta' then 'orders.reopen'
    else null
  end;
  if required_permission is null then
    raise exception 'Status inválido';
  end if;
  perform os_private.require_permission(required_permission);
  perform os_private.os_change_status(target,next_status,reason);
end;
$$;
create function public.os_assign_order(
  target uuid,target_unit uuid,target_responsible uuid,
  target_opened_by uuid,target_category uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.update');
  perform os_private.require_permission('orders.assign');
  perform os_private.os_assign_order(target,target_unit,target_responsible,
    target_opened_by,target_category);
end;
$$;
create function public.os_edit_order(
  target uuid,new_title text,new_priority text,detail_patch jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.update');
  perform os_private.os_edit_order(target,new_title,new_priority,detail_patch);
end;
$$;
create function public.os_complete_order(target uuid,solution text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.complete');
  perform os_private.os_complete_order(target,solution);
end;
$$;
create function public.os_cancel_order(target uuid,justification text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.cancel');
  perform os_private.os_cancel_order(target,justification);
end;
$$;
create function public.os_reopen_order(target uuid,justification text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.reopen');
  perform os_private.os_reopen_order(target,justification);
end;
$$;

-- Anexos não possuem uma capacidade independente no catálogo atual. Upload e
-- limpeza do próprio upload exigem acesso à OS; reconciliação operacional
-- exige edição e continua restrita ao administrador pela implementação antiga.
alter function public.os_begin_attachment_upload(uuid,uuid,text,text,bigint,text)
  set schema os_private;
alter function public.os_complete_attachment_upload(uuid) set schema os_private;
alter function public.os_abort_attachment_upload(uuid) set schema os_private;
alter function public.os_attachment_reconciliation() set schema os_private;
alter function public.os_reconcile_attachment(uuid) set schema os_private;

create function public.os_begin_attachment_upload(
  target_order uuid,attachment_id uuid,original_name text,
  declared_mime text,declared_size bigint,sha256 text
) returns text language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.view');
  return os_private.os_begin_attachment_upload(target_order,attachment_id,
    original_name,declared_mime,declared_size,sha256);
end;
$$;
create function public.os_complete_attachment_upload(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.view');
  return os_private.os_complete_attachment_upload(target);
end;
$$;
create function public.os_abort_attachment_upload(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.view');
  return os_private.os_abort_attachment_upload(target);
end;
$$;
create function public.os_attachment_reconciliation()
returns table(
  issue text,path text,attachment_id uuid,order_id uuid,
  metadata_size bigint,storage_size bigint,storage_status text,
  created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.update');
  return query select * from os_private.os_attachment_reconciliation();
end;
$$;
create function public.os_reconcile_attachment(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('orders.update');
  return os_private.os_reconcile_attachment(target);
end;
$$;

-- Administração: create/update/delete/manage permanecem independentes.
alter function public.os_save_unit(uuid,text,text,text,text,boolean)
  set schema os_private;
alter function public.os_save_catalog(uuid,text,text,jsonb,boolean)
  set schema os_private;
alter function public.os_save_membership(uuid,uuid,uuid,text,boolean,text)
  set schema os_private;
alter function public.os_grant_admin(uuid,text,uuid) set schema os_private;
alter function public.os_revoke_admin(uuid) set schema os_private;
alter function public.os_reclassify_admin(uuid,uuid,text,boolean,text)
  set schema os_private;
alter function public.os_professional_memberships(integer,integer)
  set schema os_private;
alter function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,boolean,boolean
) set schema os_private;
alter function public.os_prepare_professional_identity_change(uuid,text,text)
  set schema os_private;
alter function public.os_restore_professional_identity(uuid,text)
  set schema os_private;

create function public.os_save_unit(
  target uuid,unit_name text,unit_type text,unit_address text,
  unit_coordinates text,unit_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission(
    case when target is null then 'units.create' else 'units.update' end
  );
  return os_private.os_save_unit(target,unit_name,unit_type,unit_address,
    unit_coordinates,unit_active);
end;
$$;
create function public.os_save_catalog(
  target uuid,catalog_kind text,catalog_name text,catalog_data jsonb,
  catalog_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission(catalog_kind ||
    case when target is null then '.create' else '.update' end);
  return os_private.os_save_catalog(target,catalog_kind,catalog_name,
    catalog_data,catalog_active);
end;
$$;
create function public.os_save_membership(
  target uuid,target_user uuid,target_unit uuid,target_role text,
  target_active boolean,target_name text
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission(case
    when not target_active then 'professionals.delete'
    when target is null then 'professionals.create'
    else 'professionals.update' end);
  return os_private.os_save_membership(target,target_user,target_unit,
    target_role,target_active,target_name);
end;
$$;
create function public.os_grant_admin(
  target_user uuid,target_name text,replaced_membership uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('professionals.manage');
  return os_private.os_grant_admin(target_user,target_name,replaced_membership);
end;
$$;
create function public.os_revoke_admin(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('professionals.manage');
  perform os_private.os_revoke_admin(target);
end;
$$;
create function public.os_reclassify_admin(
  target uuid,target_unit uuid,target_role text,target_active boolean,
  target_name text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('professionals.manage');
  perform os_private.os_reclassify_admin(target,target_unit,target_role,
    target_active,target_name);
end;
$$;
create function public.os_professional_memberships(
  page_size integer default 25,page_offset integer default 0
) returns table(
  membership_id uuid,professional_id uuid,professional_name text,
  institutional_email text,registration text,job_title text,
  professional_active boolean,identity_linked boolean,relink_pending boolean,
  unit_id uuid,role text,membership_active boolean,total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform os_private.require_permission('professionals.view');
  return query select * from os_private.os_professional_memberships(
    page_size,page_offset
  );
end;
$$;
create function public.os_save_professional_membership(
  target_membership uuid,target_professional uuid,professional_email text,
  professional_name text,professional_registration text,
  professional_position text,target_unit uuid,target_role text,
  professional_active boolean,membership_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if target_role = 'admin' or exists (
    select 1
    from public.os_memberships m
    where m.id = target_membership and m.role = 'admin'
  ) then
    perform os_private.require_permission('professionals.manage');
  end if;
  perform os_private.require_permission(case
    when not professional_active or not membership_active
      then 'professionals.delete'
    when target_professional is null then 'professionals.create'
    else 'professionals.update' end);
  return os_private.os_save_professional_membership(target_membership,
    target_professional,professional_email,professional_name,
    professional_registration,professional_position,target_unit,target_role,
    professional_active,membership_active);
end;
$$;
create function public.os_prepare_professional_identity_change(
  target_professional uuid,new_email text,justification text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('professionals.manage');
  perform os_private.os_prepare_professional_identity_change(
    target_professional,new_email,justification
  );
end;
$$;
create function public.os_restore_professional_identity(
  target_professional uuid,justification text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.require_permission('professionals.manage');
  perform os_private.os_restore_professional_identity(
    target_professional,justification
  );
end;
$$;

-- O contrato de ações da interface também respeita permissões independentes.
alter function public.os_order_available_actions(uuid) set schema os_private;
create function public.os_order_available_actions(target uuid)
returns table(operation text)
language sql stable security definer set search_path = '' as $$
  select available.operation
  from os_private.os_order_available_actions(target) available
  where os_private.has_permission(case available.operation
    when 'RECONCILE' then 'orders.update'
    when 'TRIAGE' then 'orders.triage'
    when 'FORWARD' then 'orders.forward'
    when 'ASSIGN' then 'orders.assign'
    when 'REASSIGN' then 'orders.reassign'
    when 'START_SERVICE' then 'orders.attend'
    when 'ADD_SERVICE_ENTRY' then 'orders.attend'
    when 'WAIT_INFORMATION' then 'orders.wait_information'
    when 'RESUME' then 'orders.resume'
    when 'COMPLETE' then 'orders.complete'
    when 'CANCEL' then 'orders.cancel'
    when 'REOPEN' then 'orders.reopen'
    when 'EDIT' then 'orders.update'
    else '' end
  );
$$;

-- Nenhuma implementação interna pode ser chamada pelo papel autenticado.
revoke all on all functions in schema os_private from public,anon,authenticated;
-- Funções chamadas diretamente por policies precisam de EXECUTE para que a
-- expressão de RLS possa ser avaliada. Predicados internos continuam privados.
grant execute on function os_private.is_admin() to authenticated;
grant execute on function os_private.has_membership() to authenticated;
grant execute on function os_private.has_permission(text) to authenticated;
grant execute on function os_private.can_read_order(public.os_orders) to authenticated;
grant execute on function os_private.can_read_order_id(uuid) to authenticated;
grant execute on function os_private.can_write_order(uuid) to authenticated;
grant execute on function os_private.can_read_catalog(public.os_catalogs) to authenticated;
grant execute on function os_private.can_read_order_event(uuid,text) to authenticated;
grant execute on function os_private.can_read_service_entry(uuid) to authenticated;
grant execute on function os_private.can_read_attachment(public.os_attachments) to authenticated;
grant execute on function os_private.can_upload_attachment_object(text) to authenticated;
grant usage on schema os_private to authenticated;

revoke all on function
  public.os_has_permission(text),
  public.os_current_permissions(),
  public.os_open_order(text,uuid,uuid,text,jsonb,uuid,uuid,uuid),
  public.os_reconcile_order(uuid,bigint,uuid,uuid,uuid),
  public.os_start_triage(uuid,bigint),
  public.os_forward_order(uuid,bigint,uuid),
  public.os_assign_order(uuid,bigint,uuid),
  public.os_reassign_order(uuid,bigint,uuid,text),
  public.os_start_service(uuid,bigint),
  public.os_add_service_entry(uuid,bigint,text,text,timestamptz),
  public.os_wait_for_information(uuid,bigint,text,text),
  public.os_resume_service(uuid,bigint),
  public.os_complete_order(uuid,bigint,text),
  public.os_cancel_order(uuid,bigint,text),
  public.os_reopen_order(uuid,bigint,text),
  public.os_edit_order_controlled(uuid,bigint,text,text,text,jsonb),
  public.os_change_status(uuid,text,text),
  public.os_assign_order(uuid,uuid,uuid,uuid,uuid),
  public.os_edit_order(uuid,text,text,jsonb),
  public.os_complete_order(uuid,text),
  public.os_cancel_order(uuid,text),
  public.os_reopen_order(uuid,text),
  public.os_begin_attachment_upload(uuid,uuid,text,text,bigint,text),
  public.os_complete_attachment_upload(uuid),
  public.os_abort_attachment_upload(uuid),
  public.os_attachment_reconciliation(),
  public.os_reconcile_attachment(uuid),
  public.os_save_unit(uuid,text,text,text,text,boolean),
  public.os_save_catalog(uuid,text,text,jsonb,boolean),
  public.os_save_membership(uuid,uuid,uuid,text,boolean,text),
  public.os_grant_admin(uuid,text,uuid),
  public.os_revoke_admin(uuid),
  public.os_reclassify_admin(uuid,uuid,text,boolean,text),
  public.os_professional_memberships(integer,integer),
  public.os_save_professional_membership(
    uuid,uuid,text,text,text,text,uuid,text,boolean,boolean
  ),
  public.os_prepare_professional_identity_change(uuid,text,text),
  public.os_restore_professional_identity(uuid,text),
  public.os_order_available_actions(uuid)
from public,anon;
grant execute on function public.os_has_permission(text) to authenticated;
grant execute on function public.os_current_permissions() to authenticated;

grant execute on function public.os_open_order(text,uuid,uuid,text,jsonb,uuid,uuid,uuid) to authenticated;
grant execute on function public.os_reconcile_order(uuid,bigint,uuid,uuid,uuid) to authenticated;
grant execute on function public.os_start_triage(uuid,bigint) to authenticated;
grant execute on function public.os_forward_order(uuid,bigint,uuid) to authenticated;
grant execute on function public.os_assign_order(uuid,bigint,uuid) to authenticated;
grant execute on function public.os_reassign_order(uuid,bigint,uuid,text) to authenticated;
grant execute on function public.os_start_service(uuid,bigint) to authenticated;
grant execute on function public.os_add_service_entry(uuid,bigint,text,text,timestamptz) to authenticated;
grant execute on function public.os_wait_for_information(uuid,bigint,text,text) to authenticated;
grant execute on function public.os_resume_service(uuid,bigint) to authenticated;
grant execute on function public.os_complete_order(uuid,bigint,text) to authenticated;
grant execute on function public.os_cancel_order(uuid,bigint,text) to authenticated;
grant execute on function public.os_reopen_order(uuid,bigint,text) to authenticated;
grant execute on function public.os_edit_order_controlled(uuid,bigint,text,text,text,jsonb) to authenticated;
grant execute on function public.os_change_status(uuid,text,text) to authenticated;
grant execute on function public.os_assign_order(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.os_edit_order(uuid,text,text,jsonb) to authenticated;
grant execute on function public.os_complete_order(uuid,text) to authenticated;
grant execute on function public.os_cancel_order(uuid,text) to authenticated;
grant execute on function public.os_reopen_order(uuid,text) to authenticated;
grant execute on function public.os_begin_attachment_upload(uuid,uuid,text,text,bigint,text) to authenticated;
grant execute on function public.os_complete_attachment_upload(uuid) to authenticated;
grant execute on function public.os_abort_attachment_upload(uuid) to authenticated;
grant execute on function public.os_attachment_reconciliation() to authenticated;
grant execute on function public.os_reconcile_attachment(uuid) to authenticated;
grant execute on function public.os_save_unit(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.os_save_catalog(uuid,text,text,jsonb,boolean) to authenticated;
grant execute on function public.os_save_membership(uuid,uuid,uuid,text,boolean,text) to authenticated;
grant execute on function public.os_grant_admin(uuid,text,uuid) to authenticated;
grant execute on function public.os_revoke_admin(uuid) to authenticated;
grant execute on function public.os_reclassify_admin(uuid,uuid,text,boolean,text) to authenticated;
grant execute on function public.os_professional_memberships(integer,integer) to authenticated;
grant execute on function public.os_save_professional_membership(uuid,uuid,text,text,text,text,uuid,text,boolean,boolean) to authenticated;
grant execute on function public.os_prepare_professional_identity_change(uuid,text,text) to authenticated;
grant execute on function public.os_restore_professional_identity(uuid,text) to authenticated;
grant execute on function public.os_order_available_actions(uuid) to authenticated;

commit;
