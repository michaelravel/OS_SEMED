-- Estrutura aditiva para o fluxo canônico de Ordens de Serviço.
-- Não converte estados, protocolos ou eventos históricos. Com exceção da versão
-- técnica inicial, todas as novas informações permanecem nulas até serem
-- registradas por operações explícitas da aplicação.
begin;

-- O check original é substituído por um superset. Estados legados continuam
-- aceitos durante toda a transição para o fluxo canônico.
alter table public.os_orders
  drop constraint os_orders_status_check,
  add constraint os_orders_status_check check(status in (
    'A conferir','Aberta','Em triagem','Encaminhada','Atribuída',
    'Em atendimento','Aguardando informação','Concluída','Cancelada',
    'Em análise','Em execução','Aguardando material',
    'Aguardando deslocamento/logística'
  ));

alter table public.os_orders
  add column protocol_year integer,
  add column protocol_code text,
  add column destination_unit_id uuid,
  add column triaged_at timestamptz,
  add column forwarded_at timestamptz,
  add column assigned_at timestamptz,
  add column service_started_at timestamptz,
  add column waiting_since timestamptz,
  add column waiting_reason text,
  add column waiting_details text,
  add column resume_status text,
  add column priority_reason text,
  add column version bigint not null default 1,
  add constraint os_orders_protocol_year_check check(
    protocol_year is null or protocol_year between 1 and 9999
  ),
  add constraint os_orders_protocol_code_check check(
    protocol_code is null or (
      protocol_code = btrim(protocol_code) and
      length(protocol_code) between 1 and 100 and
      protocol_code !~ '[[:cntrl:]]'
    )
  ),
  add constraint os_orders_destination_unit_fk
    foreign key(destination_unit_id)
    references public.os_units(id) on delete restrict,
  add constraint os_orders_waiting_reason_check check(
    waiting_reason is null or waiting_reason in (
      'material','logística','solicitante','unidade','terceiro','outro'
    )
  ),
  add constraint os_orders_waiting_details_check check(
    waiting_details is null or length(waiting_details) <= 2000
  ),
  add constraint os_orders_resume_status_check check(
    resume_status is null or resume_status in (
      'Em triagem','Encaminhada','Atribuída','Em atendimento'
    )
  ),
  add constraint os_orders_priority_reason_check check(
    priority_reason is null or length(priority_reason) <= 2000
  ),
  add constraint os_orders_version_check check(version >= 1);

create unique index os_orders_protocol_year_code_unique
  on public.os_orders(protocol_year,protocol_code)
  where protocol_year is not null and protocol_code is not null;
create index os_orders_destination_unit
  on public.os_orders(destination_unit_id)
  where destination_unit_id is not null;

-- Registro formal do trabalho executado. A autorização de usuários será
-- adicionada na etapa específica de RLS; até lá somente service_role acessa.
create table public.os_order_service_entries (
  id bigint generated always as identity primary key,
  order_id uuid not null,
  author_id uuid,
  author_membership_id uuid,
  entry_type text not null check(
    entry_type = btrim(entry_type) and length(entry_type) between 1 and 80 and
    entry_type !~ '[[:cntrl:]]'
  ),
  description text not null check(
    description = btrim(description) and length(description) between 3 and 5000
  ),
  serviced_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint os_order_service_entries_order_fk
    foreign key(order_id) references public.os_orders(id) on delete cascade,
  constraint os_order_service_entries_author_fk
    foreign key(author_id) references public.os_profiles(id) on delete restrict,
  constraint os_order_service_entries_membership_fk
    foreign key(author_membership_id)
    references public.os_memberships(id) on delete restrict,
  constraint os_order_service_entries_id_order_key unique(id,order_id)
);
create index os_order_service_entries_order_date
  on public.os_order_service_entries(order_id,serviced_at desc,created_at desc);
create index os_order_service_entries_author
  on public.os_order_service_entries(author_id)
  where author_id is not null;
create index os_order_service_entries_membership
  on public.os_order_service_entries(author_membership_id)
  where author_membership_id is not null;

alter table public.os_order_service_entries enable row level security;
revoke all on public.os_order_service_entries from anon, authenticated;
grant all on public.os_order_service_entries to service_role;
grant usage, select on sequence public.os_order_service_entries_id_seq to service_role;

create trigger order_service_entries_audit
  after insert or update or delete on public.os_order_service_entries
  for each row execute function os_private.audit_change();

-- O vínculo é opcional e mantém o modelo atual de um objeto e um metadado por
-- anexo. A FK composta impede associar um anexo a atendimento de outra OS.
alter table public.os_attachments
  add column service_entry_id bigint,
  add constraint os_attachments_service_entry_fk
    foreign key(service_entry_id,order_id)
    references public.os_order_service_entries(id,order_id) on delete restrict;
create index os_attachments_service_entry
  on public.os_attachments(service_entry_id)
  where service_entry_id is not null;

-- Campos novos permanecem nulos nos eventos existentes. A operação aceita o
-- contrato canônico e o identificador legado "advance" para futura transição.
alter table public.os_order_events
  add column event_type text,
  add column actor_membership_id uuid,
  add column metadata jsonb,
  add column operation text,
  add constraint os_order_events_event_type_check check(
    event_type is null or (
      event_type = btrim(event_type) and length(event_type) between 1 and 100 and
      event_type !~ '[[:cntrl:]]'
    )
  ),
  add constraint os_order_events_actor_membership_fk
    foreign key(actor_membership_id)
    references public.os_memberships(id) on delete restrict,
  add constraint os_order_events_metadata_check check(
    metadata is null or jsonb_typeof(metadata) = 'object'
  ),
  add constraint os_order_events_operation_check check(
    operation is null or operation in (
      'open','reconcile','start_triage','forward','assign',
      'return_to_triage','return_to_forwarding','start_service',
      'wait_for_information','resume','complete','cancel','reopen','advance'
    )
  );
create index os_order_events_actor_membership
  on public.os_order_events(actor_membership_id)
  where actor_membership_id is not null;

comment on column public.os_orders.version is
  'Versão para controle otimista de concorrência; começa em 1 e não é incrementada por esta migration.';
comment on column public.os_orders.resume_status is
  'Estado canônico para retorno após Aguardando informação.';
comment on table public.os_order_service_entries is
  'Registros formais e cronológicos do atendimento de uma Ordem de Serviço.';
comment on column public.os_attachments.service_entry_id is
  'Associação opcional do anexo com um registro formal de atendimento da mesma OS.';

commit;
