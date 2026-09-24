-- SOMENTE LEITURA. Executar e salvar a saída antes do backfill.
-- Requer a migration 202609240007_additive_order_flow_schema.sql.
begin transaction read only;

select
  to_regclass('public.os_orders') as orders_table,
  to_regclass('public.os_order_events') as events_table,
  to_regclass('public.os_order_service_entries') as service_entries_table;

select count(*) as total_orders,
  count(*) filter(where legacy_id is not null) as imported_orders,
  count(*) filter(where protocol is null) as missing_protocol_number,
  count(*) filter(where protocol_year is null) as missing_protocol_year,
  count(*) filter(where protocol_code is null) as missing_protocol_code
from public.os_orders;

select status,count(*) as orders
from public.os_orders
group by status
order by status;

select
  status as source_status,
  case status
    when 'Em análise' then 'Em triagem'
    when 'Em execução' then 'Em atendimento'
    when 'Aguardando material' then 'Aguardando informação'
    when 'Aguardando deslocamento/logística' then 'Aguardando informação'
  end as target_status,
  count(*) as candidates
from public.os_orders
where status in (
  'Em análise','Em execução','Aguardando material',
  'Aguardando deslocamento/logística'
)
group by status
order by status;

-- Exceções identificáveis sem título, descrição, nomes ou e-mails.
select o.id as order_id,o.protocol,e.exception_code,
  (o.legacy_id is not null) as imported
from public.os_orders o
cross join lateral (values
  ('missing_reconciliation',
    o.status in (
      'Em análise','Em execução','Aguardando material',
      'Aguardando deslocamento/logística'
    ) and not os_private.order_is_reconciled(o)),
  ('missing_responsible',
    o.status in (
      'Em execução','Aguardando material',
      'Aguardando deslocamento/logística'
    ) and not os_private.order_has_responsible(o)),
  ('waiting_reason_conflict',
    (o.status = 'Aguardando material' and o.waiting_reason is not null
      and o.waiting_reason <> 'material') or
    (o.status = 'Aguardando deslocamento/logística'
      and o.waiting_reason is not null and o.waiting_reason <> 'logística')),
  ('protocol_year_source_missing',
    o.protocol_year is null and o.opened_at is null),
  ('protocol_number_missing',
    o.protocol_code is null and o.protocol is null)
) as e(exception_code,applies)
where e.applies
order by order_id,exception_code;

select protocol,count(*) as occurrences
from public.os_orders
group by protocol
having count(*) > 1;

with projected as (
  select id,
    coalesce(protocol_year,extract(year from opened_at)::integer) as target_year,
    coalesce(protocol_code,protocol::text) as target_code
  from public.os_orders
)
select target_year,target_code,count(*) as occurrences,
  array_agg(id order by id) as order_ids
from projected
where target_year is not null and target_code is not null
group by target_year,target_code
having count(*) > 1;

commit;
