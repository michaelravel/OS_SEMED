-- Integridade incremental do workflow de Ordens de Serviço.
-- Preserva registros legados: nenhuma linha existente é reclassificada ou preenchida.
-- Rollback: não executar DROP em produção. Se ainda não aplicada, basta não promovê-la.
-- Depois de aplicada, preferir migration corretiva; remover estas estruturas apagaria
-- solução/reabertura e reabriria caminhos de atualização inválidos.
begin;

alter table public.os_orders
  add column resolution text,
  add column reopened_at timestamptz;

alter table public.os_orders
  add constraint os_orders_reconciled_before_progress_check
    check (
      status = 'A conferir' or
      (unit_id is not null and opened_by is not null and category_id is not null)
    ) not valid,
  add constraint os_orders_responsible_during_service_check
    check (
      status not in (
        'Em execução','Aguardando material',
        'Aguardando deslocamento/logística','Concluída'
      ) or responsible_id is not null
    ) not valid,
  add constraint os_orders_completion_content_check
    check (
      status <> 'Concluída' or (
        completed_at is not null and
        nullif(btrim(resolution),'') is not null and
        length(resolution) between 3 and 5000
      )
    ) not valid,
  add constraint os_orders_cancellation_reason_check
    check (
      status <> 'Cancelada' or (
        cancelled_at is not null and
        nullif(btrim(status_reason),'') is not null and
        length(status_reason) between 3 and 2000
      )
    ) not valid;

-- Tabela privada e estática: fonte única das transições e do tipo de operação.
create table os_private.order_status_transitions (
  from_status text not null,
  to_status text not null,
  operation text not null check(operation in ('advance','complete','cancel','reopen')),
  sort_order smallint not null,
  primary key(from_status,to_status),
  unique(from_status,operation,to_status)
);
revoke all on os_private.order_status_transitions from public, anon, authenticated;

insert into os_private.order_status_transitions(from_status,to_status,operation,sort_order) values
  ('A conferir','Aberta','advance',10),
  ('Aberta','Em análise','advance',10),
  ('Aberta','Cancelada','cancel',90),
  ('Em análise','Em execução','advance',10),
  ('Em análise','Aguardando material','advance',20),
  ('Em análise','Aguardando deslocamento/logística','advance',30),
  ('Em análise','Cancelada','cancel',90),
  ('Em execução','Em análise','advance',10),
  ('Em execução','Aguardando material','advance',20),
  ('Em execução','Aguardando deslocamento/logística','advance',30),
  ('Em execução','Concluída','complete',80),
  ('Em execução','Cancelada','cancel',90),
  ('Aguardando material','Em execução','advance',10),
  ('Aguardando material','Cancelada','cancel',90),
  ('Aguardando deslocamento/logística','Em execução','advance',10),
  ('Aguardando deslocamento/logística','Cancelada','cancel',90),
  ('Concluída','Em análise','reopen',10),
  ('Cancelada','Aberta','reopen',10);

create function os_private.can_manage_order_status(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select o.active and (
    os_private.is_admin() or exists (
      select 1 from public.os_memberships m
      where m.user_id = (select auth.uid())
        and m.active
        and m.role = 'responsavel'
        and m.unit_id = o.unit_id
        and o.responsible_id = m.user_id
    )
  );
$$;

create function os_private.order_is_reconciled(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    exists(
      select 1 from public.os_units u
      where u.id = o.unit_id and u.active
    ) and
    exists(
      select 1 from public.os_catalogs c
      where c.id = o.category_id and c.kind = 'logistics' and c.active
    ) and
    exists(
      select 1 from public.os_memberships m
      where m.user_id = o.opened_by and m.active and (
        (m.role = 'admin' and m.unit_id is null) or
        (m.role = 'solicitante' and m.unit_id = o.unit_id)
      )
    );
$$;

create function os_private.order_has_responsible(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    where m.user_id = o.responsible_id
      and m.unit_id = o.unit_id
      and m.role = 'responsavel'
      and m.active
  );
$$;

-- Complementa as CHECK constraints com vínculos que dependem de outras tabelas.
-- Como é incremental, só valida linhas inseridas ou alteradas após esta migration.
create function os_private.enforce_order_workflow_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'A conferir' and not os_private.order_is_reconciled(new) then
    raise exception 'Conciliação obrigatória antes de avançar a ordem';
  end if;
  if new.status in (
    'Em execução','Aguardando material',
    'Aguardando deslocamento/logística','Concluída'
  ) and not os_private.order_has_responsible(new) then
    raise exception 'Responsável ativo da unidade obrigatório para atendimento';
  end if;
  return new;
end;
$$;

create trigger orders_workflow_integrity
  before insert or update on public.os_orders
  for each row execute function os_private.enforce_order_workflow_row();

create or replace function public.os_change_status(
  target uuid,
  next_status text,
  reason text default ''
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  normalized_reason text := trim(coalesce(reason,''));
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if length(normalized_reason) > 2000 then raise exception 'Observação inválida'; end if;

  select o.* into current_order
  from public.os_orders o
  where o.id = target and os_private.can_manage_order_status(o)
  for update;
  if not found then raise exception 'Acesso negado'; end if;

  if not exists(
    select 1 from os_private.order_status_transitions t
    where t.from_status = current_order.status
      and t.to_status = next_status
      and t.operation = 'advance'
  ) then raise exception 'Transição de status inválida'; end if;

  if current_order.status = 'A conferir'
    and not os_private.order_is_reconciled(current_order) then
    raise exception 'Conciliação obrigatória antes de avançar a ordem';
  end if;
  if next_status in (
    'Em execução','Aguardando material','Aguardando deslocamento/logística'
  ) and not os_private.order_has_responsible(current_order) then
    raise exception 'Responsável obrigatório para atendimento';
  end if;

  update public.os_orders set
    status = next_status,
    status_reason = normalized_reason,
    updated_at = now()
  where id = target;

  insert into public.os_order_events(order_id,actor,from_status,to_status,reason)
  values(target,auth.uid(),current_order.status,next_status,normalized_reason);
end;
$$;

create function public.os_complete_order(target uuid, solution text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  normalized_solution text := trim(coalesce(solution,''));
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if length(normalized_solution) not between 3 and 5000 then
    raise exception 'Informe a solução aplicada';
  end if;

  select o.* into current_order
  from public.os_orders o
  where o.id = target and os_private.can_manage_order_status(o)
  for update;
  if not found then raise exception 'Acesso negado'; end if;
  if not os_private.order_has_responsible(current_order) then
    raise exception 'Responsável obrigatório para conclusão';
  end if;
  if not exists(
    select 1 from os_private.order_status_transitions t
    where t.from_status = current_order.status
      and t.to_status = 'Concluída'
      and t.operation = 'complete'
  ) then raise exception 'Conclusão não permitida no status atual'; end if;

  update public.os_orders set
    status = 'Concluída',
    resolution = normalized_solution,
    status_reason = normalized_solution,
    completed_at = now(),
    cancelled_at = null,
    updated_at = now()
  where id = target;

  insert into public.os_order_events(order_id,actor,from_status,to_status,reason)
  values(target,auth.uid(),current_order.status,'Concluída',normalized_solution);
end;
$$;

create function public.os_cancel_order(target uuid, justification text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  normalized_reason text := trim(coalesce(justification,''));
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if length(normalized_reason) not between 3 and 2000 then
    raise exception 'Informe a justificativa do cancelamento';
  end if;

  select o.* into current_order
  from public.os_orders o
  where o.id = target and os_private.can_manage_order_status(o)
  for update;
  if not found then raise exception 'Acesso negado'; end if;
  if not exists(
    select 1 from os_private.order_status_transitions t
    where t.from_status = current_order.status
      and t.to_status = 'Cancelada'
      and t.operation = 'cancel'
  ) then raise exception 'Cancelamento não permitido no status atual'; end if;

  update public.os_orders set
    status = 'Cancelada',
    status_reason = normalized_reason,
    cancelled_at = now(),
    completed_at = null,
    updated_at = now()
  where id = target;

  insert into public.os_order_events(order_id,actor,from_status,to_status,reason)
  values(target,auth.uid(),current_order.status,'Cancelada',normalized_reason);
end;
$$;

create function public.os_reopen_order(target uuid, justification text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  next_status text;
  normalized_reason text := trim(coalesce(justification,''));
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if length(normalized_reason) not between 3 and 2000 then
    raise exception 'Informe a justificativa da reabertura';
  end if;

  select o.* into current_order
  from public.os_orders o
  where o.id = target and os_private.can_manage_order_status(o)
  for update;
  if not found then raise exception 'Acesso negado'; end if;

  select t.to_status into next_status
  from os_private.order_status_transitions t
  where t.from_status = current_order.status and t.operation = 'reopen';
  if next_status is null then raise exception 'Reabertura não permitida no status atual'; end if;
  if not os_private.order_is_reconciled(current_order) then
    raise exception 'Conciliação obrigatória antes de reabrir a ordem';
  end if;

  update public.os_orders set
    status = next_status,
    status_reason = normalized_reason,
    completed_at = null,
    cancelled_at = null,
    reopened_at = now(),
    updated_at = now()
  where id = target;

  insert into public.os_order_events(order_id,actor,from_status,to_status,reason)
  values(target,auth.uid(),current_order.status,next_status,normalized_reason);
end;
$$;

create function public.os_order_available_actions(target uuid)
returns table(next_status text, operation text)
language sql stable security definer set search_path = '' as $$
  select t.to_status, t.operation
  from public.os_orders o
  join os_private.order_status_transitions t on t.from_status = o.status
  where o.id = target
    and os_private.can_manage_order_status(o)
    and (o.status <> 'A conferir' or os_private.order_is_reconciled(o))
    and (
      t.to_status not in (
        'Em execução','Aguardando material',
        'Aguardando deslocamento/logística','Concluída'
      ) or os_private.order_has_responsible(o)
    )
  order by t.sort_order;
$$;

revoke all on function os_private.can_manage_order_status(public.os_orders) from public, anon, authenticated;
revoke all on function os_private.order_is_reconciled(public.os_orders) from public, anon, authenticated;
revoke all on function os_private.order_has_responsible(public.os_orders) from public, anon, authenticated;
revoke all on function os_private.enforce_order_workflow_row() from public, anon, authenticated;
revoke all on function public.os_change_status(uuid,text,text) from public, anon;
revoke all on function public.os_complete_order(uuid,text) from public, anon;
revoke all on function public.os_cancel_order(uuid,text) from public, anon;
revoke all on function public.os_reopen_order(uuid,text) from public, anon;
revoke all on function public.os_order_available_actions(uuid) from public, anon;
grant execute on function public.os_complete_order(uuid,text) to authenticated;
grant execute on function public.os_change_status(uuid,text,text) to authenticated;
grant execute on function public.os_cancel_order(uuid,text) to authenticated;
grant execute on function public.os_reopen_order(uuid,text) to authenticated;
grant execute on function public.os_order_available_actions(uuid) to authenticated;

commit;
