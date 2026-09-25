-- Linha do tempo funcional da OS. A projeção não retorna metadata nem IDs
-- técnicos e aplica a mesma autorização dos eventos antes de resolver nomes.
begin;

alter table public.os_order_events
  drop constraint os_order_events_operation_check,
  add constraint os_order_events_operation_check check(
    operation is null or operation in (
      'open','reconcile','start_triage','forward','assign','reassign',
      'return_to_triage','return_to_forwarding','start_service',
      'add_service_entry','wait_for_information','resume','complete',
      'cancel','reopen','edit','attachment','advance'
    )
  );

create or replace function os_private.can_read_order_event(
  target uuid,
  event_kind text
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_orders o
    where o.id=target and (
      os_private.can_read_order_internal(o) or (
        os_private.is_order_requester(o) and (
          event_kind in (
            'order_opened','order_reconciled','triage_started','order_forwarded',
            'service_started','information_wait_started','service_resumed',
            'order_completed','order_canceled','order_reopened','attachment_added'
          )
        )
      )
    )
  );
$$;

create function os_private.record_ready_attachment_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  actor_membership uuid;
  attachment_event text;
begin
  if new.storage_status <> 'ready' then return new; end if;
  if tg_op='UPDATE' then
    if old.storage_status='ready' then return new; end if;
  end if;

  select o.* into current_order from public.os_orders o where o.id=new.order_id;
  if not found then return new; end if;

  actor_membership := os_private.order_actor_membership(current_order);
  if actor_membership is null and auth.uid() is not null then
    select m.id into actor_membership
    from public.os_memberships m
    where m.user_id=auth.uid() and m.active and (
      (m.role='admin' and m.unit_id is null) or
      (m.role='solicitante' and m.unit_id=current_order.unit_id) or
      (m.role in ('gestor','responsavel') and
       m.unit_id=coalesce(current_order.destination_unit_id,current_order.unit_id))
    )
    order by case m.role
      when 'responsavel' then 0 when 'solicitante' then 1
      when 'gestor' then 2 else 3 end,m.id
    limit 1;
  end if;
  attachment_event := case
    when new.service_entry_id is null then 'attachment_added'
    else 'service_attachment_added'
  end;
  perform os_private.record_order_event(
    new.order_id,current_order.status,current_order.status,
    attachment_event,'attachment','',actor_membership,
    jsonb_build_object(
      'attachment_id',new.id,
      'attachment_name',new.name,
      'size_bytes',new.size_bytes
    )
  );
  return new;
end;
$$;

create trigger attachment_ready_functional_event
  after insert or update of storage_status on public.os_attachments
  for each row execute function os_private.record_ready_attachment_event();

create function public.os_order_timeline(
  target uuid,
  page_size integer default 25,
  page_offset integer default 0
) returns table(
  event_id bigint,
  event_type text,
  created_at timestamptz,
  actor_name text,
  actor_role text,
  actor_unit_name text,
  summary text,
  from_status text,
  to_status text,
  total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  internal_access boolean;
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if page_size not between 1 and 100 or page_offset not between 0 and 2500000 then
    raise exception 'Paginação inválida';
  end if;

  select o.* into current_order
  from public.os_orders o
  where o.id=target and os_private.can_read_order(o);
  if not found then return; end if;
  internal_access := os_private.can_read_order_internal(current_order);

  return query
  select
    e.id,
    case
      when e.event_type='order_edited' and
           e.metadata->>'priority_changed'='true' then 'priority_changed'
      else e.event_type
    end,
    e.created_at,
    case
      when e.actor is null then 'Importação / sistema'
      when e.actor=(select auth.uid()) then 'Você'
      when internal_access then coalesce(actor_profile.name,'Usuário não identificado')
      else 'Equipe da OS'
    end,
    case when internal_access or e.actor=(select auth.uid()) then
      case actor_membership.role
        when 'admin' then 'Administrador'
        when 'gestor' then 'Gestor'
        when 'solicitante' then 'Solicitante'
        when 'responsavel' then 'Responsável'
        else null
      end
    end,
    case when internal_access or e.actor=(select auth.uid())
      then actor_unit.name else null end,
    case
      when e.event_type='order_forwarded' then
        case when destination_unit.name is not null
          then 'Unidade executora: ' || destination_unit.name end
      when e.event_type='order_assigned' then
        case when assigned_profile.name is not null
          then 'Responsável: ' || assigned_profile.name end
      when e.event_type='order_reassigned' then
        concat_ws(' · ',
          case when assigned_profile.name is not null
            then 'Novo responsável: ' || assigned_profile.name end,
          nullif(e.reason,'')
        )
      when e.event_type='service_entry_added' then
        case when service_entry.entry_type is not null
          then 'Tipo: ' || service_entry.entry_type end
      when e.event_type in ('attachment_added','service_attachment_added') then
        case when coalesce(attachment.name,e.metadata->>'attachment_name') is not null
          then 'Arquivo: ' || coalesce(attachment.name,e.metadata->>'attachment_name') end
      when e.event_type='service_resumed' then
        case when e.to_status is not null then 'Retorno para ' || e.to_status end
      else nullif(e.reason,'')
    end,
    e.from_status,
    e.to_status,
    count(*) over()
  from public.os_order_events e
  left join public.os_memberships actor_membership
    on actor_membership.id=e.actor_membership_id
  left join public.os_profiles actor_profile on actor_profile.id=e.actor
  left join public.os_units actor_unit on actor_unit.id=actor_membership.unit_id
  left join public.os_units destination_unit
    on destination_unit.id::text=e.metadata->>'destination_unit_id'
  left join public.os_memberships assigned_membership
    on assigned_membership.id::text=e.metadata->>'responsible_membership_id'
  left join public.os_profiles assigned_profile
    on assigned_profile.id=assigned_membership.user_id
  left join public.os_order_service_entries service_entry
    on service_entry.id::text=e.metadata->>'service_entry_id'
  left join public.os_attachments attachment
    on attachment.id::text=e.metadata->>'attachment_id'
  where e.order_id=target
    and os_private.can_read_order_event(e.order_id,e.event_type)
  order by e.created_at,e.id
  limit page_size offset page_offset;
end;
$$;

revoke all on function os_private.record_ready_attachment_event()
  from public,anon,authenticated;
revoke all on function public.os_order_timeline(uuid,integer,integer)
  from public,anon;
grant execute on function public.os_order_timeline(uuid,integer,integer)
  to authenticated;

commit;
