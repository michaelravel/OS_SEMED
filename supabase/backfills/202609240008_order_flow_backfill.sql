-- BACKFILL MANUAL. Não incluir em deploy automático e não executar primeiro
-- em Production. Execute o preflight e salve sua saída antes deste arquivo.
-- O script é transacional, determinístico e seguro para reexecução.
begin;

lock table public.os_orders in share row exclusive mode;

create temporary table order_flow_backfill_before on commit drop as
select id,protocol,legacy_id,status,protocol_year,protocol_code,waiting_reason
from public.os_orders;

create temporary table order_flow_backfill_changes (
  order_id uuid primary key,
  from_status text not null,
  to_status text not null,
  status_changed boolean not null,
  protocol_year_filled boolean not null,
  protocol_code_filled boolean not null
) on commit drop;

create temporary table order_flow_backfill_exceptions (
  order_id uuid not null,
  exception_code text not null,
  details jsonb not null default '{}',
  primary key(order_id,exception_code)
) on commit drop;

select 'before' as phase,status,count(*) as orders
from order_flow_backfill_before
group by status
order by status;

do $$
declare
  current_order public.os_orders%rowtype;
  target_status text;
  target_waiting_reason text;
  target_protocol_year integer;
  target_protocol_code text;
  status_will_change boolean;
  year_will_change boolean;
  code_will_change boolean;
  failure_state text;
begin
  for current_order in
    select o.* from public.os_orders o order by o.id for update
  loop
    target_status := current_order.status;
    target_waiting_reason := current_order.waiting_reason;
    target_protocol_year := current_order.protocol_year;
    target_protocol_code := current_order.protocol_code;

    case current_order.status
      when 'Em análise' then target_status := 'Em triagem';
      when 'Em execução' then target_status := 'Em atendimento';
      when 'Aguardando material' then
        if current_order.waiting_reason is null or
           current_order.waiting_reason = 'material' then
          target_status := 'Aguardando informação';
          target_waiting_reason := 'material';
        else
          insert into order_flow_backfill_exceptions(order_id,exception_code)
          values(current_order.id,'waiting_reason_conflict')
          on conflict do nothing;
        end if;
      when 'Aguardando deslocamento/logística' then
        if current_order.waiting_reason is null or
           current_order.waiting_reason = 'logística' then
          target_status := 'Aguardando informação';
          target_waiting_reason := 'logística';
        else
          insert into order_flow_backfill_exceptions(order_id,exception_code)
          values(current_order.id,'waiting_reason_conflict')
          on conflict do nothing;
        end if;
      else null;
    end case;

    if target_status is distinct from current_order.status and
       not os_private.order_is_reconciled(current_order) then
      insert into order_flow_backfill_exceptions(order_id,exception_code)
      values(current_order.id,'missing_reconciliation')
      on conflict do nothing;
      target_status := current_order.status;
      target_waiting_reason := current_order.waiting_reason;
    end if;

    if target_status in ('Em atendimento','Aguardando informação') and
       target_status is distinct from current_order.status and
       not os_private.order_has_responsible(current_order) then
      insert into order_flow_backfill_exceptions(order_id,exception_code)
      values(current_order.id,'missing_responsible')
      on conflict do nothing;
      target_status := current_order.status;
      target_waiting_reason := current_order.waiting_reason;
    end if;

    if target_protocol_year is null then
      if current_order.opened_at is null then
        insert into order_flow_backfill_exceptions(order_id,exception_code)
        values(current_order.id,'protocol_year_source_missing')
        on conflict do nothing;
      else
        target_protocol_year := extract(year from current_order.opened_at)::integer;
      end if;
    end if;

    if target_protocol_code is null then
      if current_order.protocol is null then
        insert into order_flow_backfill_exceptions(order_id,exception_code)
        values(current_order.id,'protocol_number_missing')
        on conflict do nothing;
      else
        -- Representação textual exata do protocolo existente: não renumera.
        target_protocol_code := current_order.protocol::text;
      end if;
    end if;

    status_will_change := target_status is distinct from current_order.status;
    year_will_change := target_protocol_year is distinct from current_order.protocol_year;
    code_will_change := target_protocol_code is distinct from current_order.protocol_code;

    if status_will_change or year_will_change or code_will_change or
       target_waiting_reason is distinct from current_order.waiting_reason then
      begin
        update public.os_orders set
          status = target_status,
          waiting_reason = target_waiting_reason,
          protocol_year = target_protocol_year,
          protocol_code = target_protocol_code
        where id = current_order.id;

        insert into order_flow_backfill_changes(
          order_id,from_status,to_status,status_changed,
          protocol_year_filled,protocol_code_filled
        ) values(
          current_order.id,current_order.status,target_status,status_will_change,
          year_will_change,code_will_change
        );

        if status_will_change then
          insert into public.os_order_events(
            order_id,actor,from_status,to_status,reason,
            event_type,actor_membership_id,metadata,operation
          )
          select
            current_order.id,null,current_order.status,target_status,'',
            'workflow_backfill',null,
            jsonb_build_object(
              'backfill_key','202609240008_order_flow',
              'source_status',current_order.status
            ),null
          where not exists(
            select 1 from public.os_order_events e
            where e.order_id = current_order.id
              and e.event_type = 'workflow_backfill'
              and e.metadata ->> 'backfill_key' = '202609240008_order_flow'
          );
        end if;
      exception when others then
        get stacked diagnostics failure_state = returned_sqlstate;
        insert into order_flow_backfill_exceptions(
          order_id,exception_code,details
        ) values(
          current_order.id,'database_integrity_rejected',
          jsonb_build_object('sqlstate',failure_state)
        ) on conflict(order_id,exception_code) do update
          set details = excluded.details;
      end;
    end if;
  end loop;
end;
$$;

-- Registro durável e idempotente das exceções, sem dados pessoais.
insert into public.os_audit(
  actor,entity,record_id,action,before_data,after_data
)
select
  null,'os_order_flow_backfill',e.order_id::text,'EXCEPTION',null,
  jsonb_build_object(
    'backfill_key','202609240008_order_flow',
    'exception_code',e.exception_code,
    'details',e.details
  )
from order_flow_backfill_exceptions e
where not exists(
  select 1 from public.os_audit a
  where a.entity = 'os_order_flow_backfill'
    and a.record_id = e.order_id::text
    and a.action = 'EXCEPTION'
    and a.after_data ->> 'backfill_key' = '202609240008_order_flow'
    and a.after_data ->> 'exception_code' = e.exception_code
);

-- Invariantes de preservação. Qualquer falha aborta toda a transação.
do $$
begin
  if (select count(*) from public.os_orders) <>
     (select count(*) from order_flow_backfill_before) then
    raise exception 'Backfill alterou a quantidade de Ordens de Serviço';
  end if;
  if exists(
    select 1 from order_flow_backfill_before b
    left join public.os_orders o on o.id = b.id
    where o.id is null or o.protocol is distinct from b.protocol
      or o.legacy_id is distinct from b.legacy_id
  ) then
    raise exception 'Backfill alterou identidade, protocolo ou legacy_id';
  end if;
  if exists(
    select protocol from public.os_orders
    group by protocol having count(*) > 1
  ) then raise exception 'Protocolos bigint duplicados após backfill'; end if;
  if exists(
    select protocol_year,protocol_code from public.os_orders
    where protocol_year is not null and protocol_code is not null
    group by protocol_year,protocol_code having count(*) > 1
  ) then raise exception 'Protocolos formais duplicados após backfill'; end if;
end;
$$;

select 'after' as phase,status,count(*) as orders
from public.os_orders
group by status
order by status;

select
  count(*) as changed_orders,
  count(*) filter(where status_changed) as normalized_statuses,
  count(*) filter(where protocol_year_filled) as protocol_years_filled,
  count(*) filter(where protocol_code_filled) as protocol_codes_filled
from order_flow_backfill_changes;

select order_id,exception_code,details
from order_flow_backfill_exceptions
order by order_id,exception_code;

commit;
