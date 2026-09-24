-- RLS do fluxo entre unidade solicitante e unidade executora.
-- Não concede UPDATE direto em OS, eventos, atendimentos ou anexos.
begin;

create function os_private.is_origin_manager(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    where m.user_id=(select auth.uid()) and m.active and m.role='gestor'
      and (m.unit_id is null or m.unit_id=o.unit_id)
  );
$$;

create function os_private.is_destination_manager(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select o.destination_unit_id is not null and exists(
    select 1 from public.os_memberships m
    where m.user_id=(select auth.uid()) and m.active and m.role='gestor'
      and (m.unit_id is null or m.unit_id=o.destination_unit_id)
  );
$$;

create function os_private.is_order_requester(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    where m.user_id=(select auth.uid()) and m.active
      and m.role='solicitante' and m.unit_id=o.unit_id
      and o.opened_by=m.user_id and o.requester_membership_id=m.id
  );
$$;

create function os_private.is_assigned_responsible(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    where m.id=o.responsible_membership_id
      and m.user_id=(select auth.uid()) and m.active
      and m.role='responsavel'
      and m.unit_id=coalesce(o.destination_unit_id,o.unit_id)
      and o.responsible_id=m.user_id
  );
$$;

create function os_private.can_read_order_internal(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.is_admin()
    or os_private.is_origin_manager(o)
    or os_private.is_destination_manager(o)
    or os_private.is_assigned_responsible(o);
$$;

create or replace function os_private.can_read_order(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.can_read_order_internal(o)
    or os_private.is_order_requester(o);
$$;

create function os_private.can_read_order_event(target uuid,event_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_orders o
    where o.id=target and (
      os_private.can_read_order_internal(o) or (
        os_private.is_order_requester(o) and (
          event_kind in (
            'order_opened','order_reconciled','triage_started','order_forwarded',
            'service_started','information_wait_started','service_resumed',
            'order_completed','order_canceled','order_reopened'
          )
        )
      )
    )
  );
$$;

create function os_private.can_read_service_entry(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_orders o
    where o.id=target and os_private.can_read_order_internal(o)
  );
$$;

create function os_private.can_read_attachment(a public.os_attachments)
returns boolean language sql stable security definer set search_path = '' as $$
  select a.storage_status='ready' and a.inspection_status <> 'rejected' and exists(
    select 1 from public.os_orders o
    where o.id=a.order_id and (
      os_private.can_read_order_internal(o) or
      (a.service_entry_id is null and os_private.is_order_requester(o))
    )
  );
$$;

create or replace function os_private.can_write_order(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_orders o
    where o.id=target and o.active and o.status not in ('Concluída','Cancelada')
      and (
        os_private.can_read_order_internal(o) or
        os_private.is_order_requester(o)
      )
  );
$$;

drop policy orders_read on public.os_orders;
create policy orders_read on public.os_orders for select to authenticated
  using(os_private.can_read_order(os_orders));

drop policy messages_read on public.os_messages;
drop policy messages_insert on public.os_messages;
create policy messages_read on public.os_messages for select to authenticated
  using(os_private.can_read_order_id(order_id));
create policy messages_insert on public.os_messages for insert to authenticated
  with check(
    author_id=(select auth.uid()) and os_private.can_write_order(order_id)
  );

drop policy order_events_read on public.os_order_events;
create policy order_events_read on public.os_order_events for select to authenticated
  using(os_private.can_read_order_event(order_id,event_type));
revoke insert,update,delete on public.os_order_events from authenticated;

create policy order_service_entries_read
  on public.os_order_service_entries for select to authenticated
  using(os_private.can_read_service_entry(order_id));
grant select on public.os_order_service_entries to authenticated;
revoke insert,update,delete on public.os_order_service_entries from authenticated;

drop policy attachments_read on public.os_attachments;
create policy attachments_read on public.os_attachments for select to authenticated
  using(os_private.can_read_attachment(os_attachments));
revoke insert,update,delete on public.os_attachments from authenticated;

drop policy os_files_read on storage.objects;
create policy os_files_read on storage.objects for select to authenticated using(
  bucket_id='os-attachments' and exists(
    select 1 from public.os_attachments a
    where a.path=storage.objects.name
      and os_private.can_read_attachment(a)
  )
);

-- Upload continua preso ao autor do metadado pendente. O helper de escrita
-- concede colaboração na OS, nunca administração sobre a unidade de origem.
create or replace function os_private.can_upload_attachment_object(target_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_attachments a
    where a.path=target_path and a.uploaded_by=(select auth.uid())
      and a.storage_status='pending' and a.inspection_status <> 'rejected'
      and os_private.can_write_order(a.order_id)
  );
$$;

revoke all on function os_private.is_origin_manager(public.os_orders) from public,anon,authenticated;
revoke all on function os_private.is_destination_manager(public.os_orders) from public,anon,authenticated;
revoke all on function os_private.is_order_requester(public.os_orders) from public,anon,authenticated;
revoke all on function os_private.is_assigned_responsible(public.os_orders) from public,anon,authenticated;
revoke all on function os_private.can_read_order_internal(public.os_orders) from public,anon,authenticated;
revoke all on function os_private.can_read_order_event(uuid,text) from public,anon,authenticated;
revoke all on function os_private.can_read_service_entry(uuid) from public,anon,authenticated;
revoke all on function os_private.can_read_attachment(public.os_attachments) from public,anon,authenticated;
revoke all on function os_private.can_upload_attachment_object(text) from public,anon,authenticated;
-- Policies são avaliadas com os privilégios do papel chamador. Somente os
-- wrappers booleanos usados diretamente pelas policies precisam de EXECUTE;
-- os predicados internos permanecem inacessíveis.
grant execute on function os_private.can_read_order_event(uuid,text) to authenticated;
grant execute on function os_private.can_read_service_entry(uuid) to authenticated;
grant execute on function os_private.can_read_attachment(public.os_attachments) to authenticated;
grant execute on function os_private.can_upload_attachment_object(text) to authenticated;

commit;
