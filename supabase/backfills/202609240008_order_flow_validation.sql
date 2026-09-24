-- SOMENTE LEITURA. Executar após o backfill em homologação e salvar a saída.
begin transaction read only;

select count(*) as total_orders,
  count(*) filter(where legacy_id is not null) as imported_orders,
  count(*) filter(where protocol_year is null) as missing_protocol_year,
  count(*) filter(where protocol_code is null) as missing_protocol_code
from public.os_orders;

select status,count(*) as orders
from public.os_orders
group by status
order by status;

select status,count(*) as unresolved_legacy_orders
from public.os_orders
where status in (
  'Em análise','Em execução','Aguardando material',
  'Aguardando deslocamento/logística'
)
group by status
order by status;

select protocol,count(*) as occurrences
from public.os_orders
group by protocol
having count(*) > 1;

select protocol_year,protocol_code,count(*) as occurrences
from public.os_orders
where protocol_year is not null and protocol_code is not null
group by protocol_year,protocol_code
having count(*) > 1;

select event_type,count(*) as events
from public.os_order_events
where event_type = 'workflow_backfill'
  and metadata ->> 'backfill_key' = '202609240008_order_flow'
group by event_type;

select
  after_data ->> 'exception_code' as exception_code,
  count(*) as exceptions
from public.os_audit
where entity = 'os_order_flow_backfill'
  and action = 'EXCEPTION'
  and after_data ->> 'backfill_key' = '202609240008_order_flow'
group by after_data ->> 'exception_code'
order by exception_code;

-- Lista mínima para conciliação: identificador técnico, protocolo e código.
select o.id as order_id,o.protocol,
  a.after_data ->> 'exception_code' as exception_code
from public.os_audit a
join public.os_orders o on o.id::text = a.record_id
where a.entity = 'os_order_flow_backfill'
  and a.action = 'EXCEPTION'
  and a.after_data ->> 'backfill_key' = '202609240008_order_flow'
order by o.id,exception_code;

commit;
