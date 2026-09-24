-- Contrato de operações disponíveis para a camada de aplicação.
-- A função apenas descreve RPCs que o usuário atual pode executar; as RPCs
-- continuam sendo a autoridade final sobre estado, versão e autorização.
begin;

drop function public.os_order_available_actions(uuid);

create function public.os_order_available_actions(target uuid)
returns table(operation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  administrator boolean;
  service_actor boolean;
begin
  if auth.uid() is null then return; end if;

  select o.* into current_order
  from public.os_orders o
  where o.id=target and o.active;
  if not found then return; end if;

  administrator := os_private.is_admin();
  service_actor := os_private.can_service_order(current_order);

  if current_order.status='A conferir' and administrator then
    operation := 'RECONCILE'; return next;
  end if;
  if current_order.status='Aberta' and administrator then
    operation := 'TRIAGE'; return next;
  end if;
  if current_order.status='Em triagem' and administrator then
    operation := 'FORWARD'; return next;
  end if;
  if current_order.status='Encaminhada' and administrator then
    operation := 'ASSIGN'; return next;
  end if;
  if current_order.status='Atribuída' and administrator then
    operation := 'REASSIGN'; return next;
  end if;
  if current_order.status='Atribuída' and service_actor then
    operation := 'START_SERVICE'; return next;
  end if;
  if current_order.status='Em atendimento' and service_actor then
    operation := 'ADD_SERVICE_ENTRY'; return next;
  end if;
  if (
    current_order.status in ('Em triagem','Encaminhada') and administrator
  ) or (
    current_order.status in ('Atribuída','Em atendimento') and service_actor
  ) then
    operation := 'WAIT_INFORMATION'; return next;
  end if;
  if current_order.status='Aguardando informação' and (
    (current_order.resume_status in ('Em triagem','Encaminhada') and administrator) or
    (current_order.resume_status in ('Atribuída','Em atendimento') and service_actor)
  ) then
    operation := 'RESUME'; return next;
  end if;
  if current_order.status='Em atendimento' and service_actor and exists(
    select 1 from public.os_order_service_entries e
    where e.order_id=current_order.id
  ) then
    operation := 'COMPLETE'; return next;
  end if;
  if current_order.status not in ('Concluída','Cancelada') and (
    (
      current_order.status in ('Atribuída','Em atendimento') or
      (
        current_order.status='Aguardando informação' and
        current_order.resume_status in ('Atribuída','Em atendimento')
      )
    ) and service_actor or
    (
      not (
        current_order.status in ('Atribuída','Em atendimento') or
        (
          current_order.status='Aguardando informação' and
          current_order.resume_status in ('Atribuída','Em atendimento')
        )
      ) and administrator
    )
  ) then
    operation := 'CANCEL'; return next;
  end if;
  if current_order.status in ('Concluída','Cancelada') and
     os_private.order_is_reconciled(current_order) and
     (administrator or service_actor) then
    operation := 'REOPEN'; return next;
  end if;
  if current_order.status not in ('Concluída','Cancelada') and administrator then
    operation := 'EDIT'; return next;
  end if;
end;
$$;

revoke all on function public.os_order_available_actions(uuid) from public,anon;
grant execute on function public.os_order_available_actions(uuid) to authenticated;

create function public.os_order_can_collaborate(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.can_write_order(target);
$$;
revoke all on function public.os_order_can_collaborate(uuid) from public,anon;
grant execute on function public.os_order_can_collaborate(uuid) to authenticated;

commit;
