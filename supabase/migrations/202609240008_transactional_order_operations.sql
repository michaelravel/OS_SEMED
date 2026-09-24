-- Operações transacionais do fluxo canônico de Ordens de Serviço.
-- Mantém as RPCs legadas; as novas assinaturas exigem versão esperada.
begin;

-- Amplia apenas o contrato de operações dos eventos.
alter table public.os_order_events
  drop constraint os_order_events_operation_check,
  add constraint os_order_events_operation_check check(
    operation is null or operation in (
      'open','reconcile','start_triage','forward','assign','reassign',
      'return_to_triage','return_to_forwarding','start_service',
      'add_service_entry','wait_for_information','resume','complete',
      'cancel','reopen','edit','advance'
    )
  );

-- Cancelar não é avançar o atendimento; uma OS ainda não conciliada pode ser
-- encerrada com justificativa. Os estados operacionais exigem responsável.
alter table public.os_orders
  drop constraint os_orders_reconciled_before_progress_check,
  add constraint os_orders_reconciled_before_progress_check check(
    status in ('A conferir','Cancelada') or
    (unit_id is not null and opened_by is not null and category_id is not null)
  ) not valid,
  drop constraint os_orders_responsible_during_service_check,
  add constraint os_orders_responsible_during_service_check check(
    (
      status not in (
        'Atribuída','Em atendimento','Em execução','Aguardando material',
        'Aguardando deslocamento/logística','Concluída'
      ) and not (
        status='Aguardando informação' and
        resume_status in ('Atribuída','Em atendimento')
      )
    ) or responsible_id is not null
  ) not valid;

-- A unidade solicitante continua em unit_id. Para o responsável, a unidade de
-- autorização e integridade passa a ser destination_unit_id quando definida.
create or replace function os_private.can_read_order(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    where m.user_id=(select auth.uid()) and m.active and (
      (m.role in ('admin','gestor') and (m.unit_id is null or m.unit_id=o.unit_id or m.unit_id=o.destination_unit_id)) or
      (m.role='solicitante' and m.unit_id=o.unit_id and o.opened_by=m.user_id) or
      (m.role='responsavel' and m.unit_id=coalesce(o.destination_unit_id,o.unit_id)
        and o.responsible_id=m.user_id and o.responsible_membership_id=m.id)
    )
  );
$$;

create or replace function os_private.can_write_order(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_orders o
    join public.os_memberships m on m.user_id=(select auth.uid()) and m.active
    where o.id=target and o.active and o.status not in ('Concluída','Cancelada') and (
      (m.role='admin' and m.unit_id is null) or
      (m.role='solicitante' and m.unit_id=o.unit_id and o.opened_by=m.user_id) or
      (m.role='responsavel' and m.unit_id=coalesce(o.destination_unit_id,o.unit_id)
        and o.responsible_id=m.user_id and o.responsible_membership_id=m.id)
    )
  );
$$;

create or replace function os_private.order_has_responsible(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    where (o.responsible_membership_id is null or m.id=o.responsible_membership_id)
      and m.user_id=o.responsible_id
      and m.unit_id=coalesce(o.destination_unit_id,o.unit_id)
      and m.role='responsavel' and m.active
  );
$$;

create or replace function os_private.can_manage_order_status(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select o.active and (
    os_private.is_admin() or exists(
      select 1 from public.os_memberships m
      where m.id=o.responsible_membership_id
        and m.user_id=(select auth.uid()) and m.active
        and m.role='responsavel'
        and m.unit_id=coalesce(o.destination_unit_id,o.unit_id)
    )
  );
$$;

create or replace function os_private.protect_order_memberships()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(
    select 1 from public.os_orders o
    where o.requester_membership_id=old.id and not (
      new.user_id=o.opened_by and (
        (new.role='solicitante' and new.unit_id=o.unit_id) or
        (new.role='admin' and new.unit_id is null)
      )
    )
  ) then raise exception 'Vínculo de solicitante referenciado por ordem'; end if;
  if exists(
    select 1 from public.os_orders o
    where o.responsible_membership_id=old.id and not (
      new.user_id=o.responsible_id and new.role='responsavel'
      and new.unit_id=coalesce(o.destination_unit_id,o.unit_id)
    )
  ) then raise exception 'Vínculo de responsável referenciado por ordem'; end if;
  return new;
end;
$$;

create or replace function os_private.validate_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare execution_unit uuid;
begin
  execution_unit := coalesce(new.destination_unit_id,new.unit_id);
  if new.driver_id is null and coalesce(new.details ->> 'driver','') <> '' then
    select c.id into new.driver_id from public.os_catalogs c
    where c.id::text=new.details ->> 'driver' and c.kind='drivers';
    if not found then raise exception 'Referência de catálogo inválida: driver'; end if;
  end if;
  if new.vehicle_id is null and coalesce(new.details ->> 'vehicle','') <> '' then
    select c.id into new.vehicle_id from public.os_catalogs c
    where c.id::text=new.details ->> 'vehicle' and c.kind='vehicles';
    if not found then raise exception 'Referência de catálogo inválida: vehicle'; end if;
  end if;
  if new.route_id is null and coalesce(new.details ->> 'route','') <> '' then
    select c.id into new.route_id from public.os_catalogs c
    where c.id::text=new.details ->> 'route' and c.kind='routes';
    if not found then raise exception 'Referência de catálogo inválida: route'; end if;
  end if;
  if new.driver_id is not null then new.details:=new.details-'driver'; end if;
  if new.vehicle_id is not null then new.details:=new.details-'vehicle'; end if;
  if new.route_id is not null then new.details:=new.details-'route'; end if;

  if new.opened_by is null then
    new.requester_membership_id:=null;
  elsif new.requester_membership_id is null then
    select m.id into new.requester_membership_id from public.os_memberships m
    where m.user_id=new.opened_by and (
      (m.role='solicitante' and m.unit_id=new.unit_id) or
      (m.role='admin' and m.unit_id is null)
    ) order by case when m.role='solicitante' then 0 else 1 end,m.active desc,m.id limit 1;
  end if;
  if new.opened_by is not null and not exists(
    select 1 from public.os_memberships m
    where m.id=new.requester_membership_id and m.user_id=new.opened_by and (
      (m.role='solicitante' and m.unit_id=new.unit_id) or
      (m.role='admin' and m.unit_id is null)
    )
  ) then raise exception 'Solicitante sem vínculo verificável'; end if;

  if new.responsible_id is null then
    new.responsible_membership_id:=null;
  elsif new.responsible_membership_id is null then
    select m.id into new.responsible_membership_id from public.os_memberships m
    where m.user_id=new.responsible_id and m.unit_id=execution_unit
      and m.role='responsavel'
    order by m.active desc,m.id limit 1;
  end if;
  if new.responsible_id is not null and not exists(
    select 1 from public.os_memberships m
    where m.id=new.responsible_membership_id and m.user_id=new.responsible_id
      and m.unit_id=execution_unit and m.role='responsavel'
  ) then raise exception 'Responsável sem vínculo verificável'; end if;

  if auth.uid() is not null then
    if new.unit_id is null or not exists(
      select 1 from public.os_units where id=new.unit_id and active
    ) then raise exception 'Unidade inválida'; end if;
    if new.destination_unit_id is not null and not exists(
      select 1 from public.os_units where id=new.destination_unit_id and active
    ) then raise exception 'Unidade executora inválida'; end if;
    if new.category_id is not null and not exists(
      select 1 from public.os_catalogs where id=new.category_id and kind='logistics' and active
    ) then raise exception 'Classificação inválida'; end if;
    if new.responsible_id is not null and not exists(
      select 1 from public.os_memberships where id=new.responsible_membership_id and active
    ) then raise exception 'Responsável sem vínculo ativo'; end if;
    if new.opened_by is not null and not exists(
      select 1 from public.os_memberships where id=new.requester_membership_id and active
    ) then raise exception 'Solicitante sem vínculo ativo'; end if;
    if new.driver_id is not null and not exists(
      select 1 from public.os_catalogs where id=new.driver_id and kind='drivers' and active
    ) then raise exception 'Motorista inválido'; end if;
    if new.vehicle_id is not null and not exists(
      select 1 from public.os_catalogs where id=new.vehicle_id and kind='vehicles' and active
    ) then raise exception 'Veículo inválido'; end if;
    if new.route_id is not null and not exists(
      select 1 from public.os_catalogs where id=new.route_id and kind='routes' and active
    ) then raise exception 'Rota inválida'; end if;
  end if;
  if new.status <> 'A conferir' and (new.opened_by is null or new.category_id is null) then
    raise exception 'Conciliação obrigatória antes de avançar a ordem';
  end if;
  if new.status in (
    'Atribuída','Em atendimento','Aguardando material',
    'Aguardando deslocamento/logística','Concluída'
  ) and new.responsible_id is null then
    raise exception 'Responsável obrigatório para atendimento';
  end if;
  if tg_op='INSERT' then
    new.created_at:=coalesce(new.created_at,now());
    new.opened_at:=coalesce(new.opened_at,now());
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

create or replace function os_private.can_read_catalog(c public.os_catalogs)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.is_admin() or (
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
  );
$$;

create function os_private.lock_order(target uuid,expected_version bigint)
returns public.os_orders
language plpgsql security definer set search_path = '' as $$
declare
  locked_order public.os_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if expected_version is null or expected_version < 1 then
    raise exception 'Versão esperada inválida';
  end if;
  select o.* into locked_order
  from public.os_orders o
  where o.id = target and o.active
  for update;
  if not found then raise exception 'Ordem não encontrada'; end if;
  if locked_order.version <> expected_version then
    raise exception 'A ordem foi alterada por outro usuário';
  end if;
  return locked_order;
end;
$$;

create function os_private.order_actor_membership(o public.os_orders)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select m.id from public.os_memberships m
      where m.id = o.responsible_membership_id
        and m.user_id = (select auth.uid()) and m.active
      limit 1
    ),
    (
      select m.id from public.os_memberships m
      where m.user_id = (select auth.uid()) and m.active
        and m.role = 'admin' and m.unit_id is null
      order by m.id limit 1
    )
  );
$$;

create function os_private.order_has_active_assignee(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    where m.id = o.responsible_membership_id
      and m.user_id = o.responsible_id
      and m.role = 'responsavel' and m.active
      and m.unit_id = coalesce(o.destination_unit_id,o.unit_id)
  );
$$;

create function os_private.can_service_order(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.order_has_active_assignee(o) and (
    os_private.is_admin() or exists(
      select 1 from public.os_memberships m
      where m.id = o.responsible_membership_id
        and m.user_id = (select auth.uid()) and m.active
        and m.role = 'responsavel'
    )
  );
$$;

create function os_private.record_order_event(
  target uuid,
  previous_status text,
  next_status text,
  event_kind text,
  operation_kind text,
  event_reason text,
  actor_membership uuid,
  event_metadata jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.os_order_events(
    order_id,actor,from_status,to_status,reason,event_type,
    actor_membership_id,metadata,operation
  ) values(
    target,auth.uid(),previous_status,next_status,event_reason,event_kind,
    actor_membership,coalesce(event_metadata,'{}'::jsonb),operation_kind
  );
end;
$$;

create function os_private.reject_order_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Eventos de Ordem de Serviço são imutáveis';
end;
$$;
create trigger order_events_immutable
  before update or delete on public.os_order_events
  for each row execute function os_private.reject_order_event_mutation();

create function public.os_open_order(
  order_title text,
  target_unit uuid,
  target_category uuid,
  order_priority text,
  order_details jsonb,
  target_driver uuid,
  target_vehicle uuid,
  target_route uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  created_id uuid;
  actor_membership uuid;
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if length(btrim(coalesce(order_title,''))) not between 3 and 500 or
     order_priority not in ('Baixa','Normal','Alta','Urgente') or
     jsonb_typeof(order_details) <> 'object' then
    raise exception 'Dados da ordem inválidos';
  end if;
  select m.id into actor_membership
  from public.os_memberships m
  where m.user_id = auth.uid() and m.active and (
    (m.role = 'admin' and m.unit_id is null) or
    (m.role = 'solicitante' and m.unit_id = target_unit)
  ) order by case when m.role = 'solicitante' then 0 else 1 end,m.id limit 1;
  if actor_membership is null then raise exception 'Acesso negado'; end if;
  if not exists(select 1 from public.os_units u where u.id=target_unit and u.active) or
     not exists(select 1 from public.os_catalogs c where c.id=target_category and c.kind='logistics' and c.active) then
    raise exception 'Unidade ou classificação inválida';
  end if;

  insert into public.os_orders(
    title,unit_id,opened_by,requester_membership_id,category_id,
    driver_id,vehicle_id,route_id,priority,details,status,opened_at
  ) values(
    btrim(order_title),target_unit,auth.uid(),actor_membership,target_category,
    target_driver,target_vehicle,target_route,order_priority,order_details,'Aberta',now()
  ) returning id into created_id;
  perform os_private.record_order_event(
    created_id,null,'Aberta','order_opened','open','',actor_membership,'{}'::jsonb
  );
  return created_id;
end;
$$;

create function public.os_reconcile_order(
  target uuid,expected_version bigint,target_unit uuid,
  target_opened_by uuid,target_category uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  requester_membership uuid;
  actor_membership uuid;
begin
  current_order := os_private.lock_order(target,expected_version);
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if current_order.status <> 'A conferir' then raise exception 'Conciliação não permitida no status atual'; end if;
  if not exists(select 1 from public.os_units u where u.id=target_unit and u.active) or
     not exists(select 1 from public.os_catalogs c where c.id=target_category and c.kind='logistics' and c.active) then
    raise exception 'Unidade ou classificação inválida';
  end if;
  select m.id into requester_membership from public.os_memberships m
  where m.user_id=target_opened_by and m.active and (
    (m.role='solicitante' and m.unit_id=target_unit) or
    (m.role='admin' and m.unit_id is null)
  ) order by case when m.role='solicitante' then 0 else 1 end,m.id limit 1;
  if requester_membership is null then raise exception 'Solicitante sem vínculo ativo'; end if;
  actor_membership := os_private.order_actor_membership(current_order);

  update public.os_orders set
    unit_id=target_unit,opened_by=target_opened_by,
    requester_membership_id=requester_membership,category_id=target_category,
    status='Em triagem',triaged_at=now(),version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(
    target,current_order.status,'Em triagem','order_reconciled','reconcile','',
    actor_membership,jsonb_build_object('version',expected_version+1)
  );
end;
$$;

create function public.os_start_triage(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype; actor_membership uuid;
begin
  current_order := os_private.lock_order(target,expected_version);
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if current_order.status <> 'Aberta' then raise exception 'Triagem não permitida no status atual'; end if;
  if not os_private.order_is_reconciled(current_order) then raise exception 'Ordem não conciliada'; end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set status='Em triagem',triaged_at=now(),version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Em triagem',
    'triage_started','start_triage','',actor_membership,
    jsonb_build_object('version',expected_version+1));
end;
$$;

create function public.os_forward_order(
  target uuid,expected_version bigint,destination_unit uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype; actor_membership uuid;
begin
  current_order := os_private.lock_order(target,expected_version);
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if current_order.status <> 'Em triagem' then raise exception 'Encaminhamento não permitido no status atual'; end if;
  if not exists(select 1 from public.os_units u where u.id=destination_unit and u.active) then
    raise exception 'Unidade executora inválida';
  end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set destination_unit_id=destination_unit,
    status='Encaminhada',forwarded_at=now(),version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Encaminhada',
    'order_forwarded','forward','',actor_membership,
    jsonb_build_object('destination_unit_id',destination_unit,'version',expected_version+1));
end;
$$;

create function public.os_assign_order(
  target uuid,expected_version bigint,responsible_membership uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  assignee public.os_memberships%rowtype;
  actor_membership uuid;
begin
  current_order := os_private.lock_order(target,expected_version);
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if current_order.status <> 'Encaminhada' then raise exception 'Atribuição não permitida no status atual'; end if;
  if current_order.destination_unit_id is null then raise exception 'Unidade executora obrigatória'; end if;
  select m.* into assignee from public.os_memberships m
  where m.id=responsible_membership and m.active and m.role='responsavel'
    and m.unit_id=current_order.destination_unit_id;
  if not found then raise exception 'Vínculo de responsável inválido'; end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set responsible_id=assignee.user_id,
    responsible_membership_id=assignee.id,status='Atribuída',assigned_at=now(),
    version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Atribuída',
    'order_assigned','assign','',actor_membership,
    jsonb_build_object('responsible_membership_id',assignee.id,'version',expected_version+1));
end;
$$;

create function public.os_reassign_order(
  target uuid,expected_version bigint,responsible_membership uuid,justification text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  assignee public.os_memberships%rowtype;
  actor_membership uuid;
  normalized_reason text := btrim(coalesce(justification,''));
begin
  current_order := os_private.lock_order(target,expected_version);
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if current_order.status <> 'Atribuída' then raise exception 'Reatribuição não permitida no status atual'; end if;
  if length(normalized_reason) not between 3 and 2000 then raise exception 'Justificativa obrigatória'; end if;
  select m.* into assignee from public.os_memberships m
  where m.id=responsible_membership and m.active and m.role='responsavel'
    and m.unit_id=current_order.destination_unit_id;
  if not found or assignee.id=current_order.responsible_membership_id then
    raise exception 'Novo vínculo de responsável inválido';
  end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set responsible_id=assignee.user_id,
    responsible_membership_id=assignee.id,assigned_at=now(),version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,current_order.status,
    'order_reassigned','reassign',normalized_reason,actor_membership,
    jsonb_build_object(
      'previous_membership_id',current_order.responsible_membership_id,
      'responsible_membership_id',assignee.id,'version',expected_version+1
    ));
end;
$$;

create function public.os_start_service(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype; actor_membership uuid;
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status <> 'Atribuída' then raise exception 'Atendimento não permitido no status atual'; end if;
  if not os_private.can_service_order(current_order) then raise exception 'Responsável não autorizado'; end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set status='Em atendimento',service_started_at=now(),version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Em atendimento',
    'service_started','start_service','',actor_membership,
    jsonb_build_object('version',expected_version+1));
end;
$$;

create function public.os_add_service_entry(
  target uuid,expected_version bigint,entry_kind text,
  entry_description text,serviced_on timestamptz
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  actor_membership uuid;
  created_entry bigint;
  normalized_kind text := btrim(coalesce(entry_kind,''));
  normalized_description text := btrim(coalesce(entry_description,''));
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status <> 'Em atendimento' then raise exception 'Registro não permitido no status atual'; end if;
  if not os_private.can_service_order(current_order) then raise exception 'Responsável não autorizado'; end if;
  if length(normalized_kind) not between 1 and 80 or normalized_kind ~ '[[:cntrl:]]' or
     length(normalized_description) not between 3 and 5000 or serviced_on is null then
    raise exception 'Registro de atendimento inválido';
  end if;
  actor_membership := os_private.order_actor_membership(current_order);
  if actor_membership is null then raise exception 'Vínculo do autor não encontrado'; end if;
  insert into public.os_order_service_entries(
    order_id,author_id,author_membership_id,entry_type,description,serviced_at
  ) values(
    target,auth.uid(),actor_membership,normalized_kind,normalized_description,serviced_on
  ) returning id into created_entry;
  update public.os_orders set version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,current_order.status,
    'service_entry_added','add_service_entry','',actor_membership,
    jsonb_build_object('service_entry_id',created_entry,'version',expected_version+1));
  return created_entry;
end;
$$;

create function public.os_wait_for_information(
  target uuid,expected_version bigint,wait_reason text,wait_details text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  actor_membership uuid;
  normalized_details text := btrim(coalesce(wait_details,''));
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status not in ('Em triagem','Encaminhada','Atribuída','Em atendimento') then
    raise exception 'Espera não permitida no status atual';
  end if;
  if wait_reason not in ('material','logística','solicitante','unidade','terceiro','outro') or
     length(normalized_details) not between 3 and 2000 then
    raise exception 'Motivo de espera inválido';
  end if;
  if current_order.status in ('Atribuída','Em atendimento') then
    if not os_private.can_service_order(current_order) then raise exception 'Acesso negado'; end if;
  elsif not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set status='Aguardando informação',
    waiting_since=now(),waiting_reason=wait_reason,waiting_details=normalized_details,
    resume_status=current_order.status,version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Aguardando informação',
    'information_wait_started','wait_for_information',normalized_details,actor_membership,
    jsonb_build_object('waiting_reason',wait_reason,'resume_status',current_order.status,
      'version',expected_version+1));
end;
$$;

create function public.os_resume_service(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype; actor_membership uuid; return_status text;
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status <> 'Aguardando informação' then raise exception 'Retomada não permitida no status atual'; end if;
  return_status := current_order.resume_status;
  if return_status not in ('Em triagem','Encaminhada','Atribuída','Em atendimento') then
    raise exception 'Estado de retomada inválido';
  end if;
  if return_status in ('Atribuída','Em atendimento') then
    if not os_private.can_service_order(current_order) then raise exception 'Acesso negado'; end if;
  elsif not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set status=return_status,waiting_since=null,
    waiting_reason=null,waiting_details=null,resume_status=null,version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,return_status,
    'service_resumed','resume','',actor_membership,
    jsonb_build_object('waiting_reason',current_order.waiting_reason,
      'waiting_details',current_order.waiting_details,'version',expected_version+1));
end;
$$;

create function public.os_complete_order(
  target uuid,expected_version bigint,solution text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  actor_membership uuid;
  normalized_solution text := btrim(coalesce(solution,''));
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status <> 'Em atendimento' then raise exception 'Conclusão não permitida no status atual'; end if;
  if not os_private.can_service_order(current_order) then raise exception 'Acesso negado'; end if;
  if length(normalized_solution) not between 3 and 5000 then raise exception 'Solução obrigatória'; end if;
  if not exists(select 1 from public.os_order_service_entries e where e.order_id=target) then
    raise exception 'Registre o atendimento antes da conclusão';
  end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set status='Concluída',resolution=normalized_solution,
    status_reason=normalized_solution,completed_at=now(),cancelled_at=null,
    version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Concluída',
    'order_completed','complete',normalized_solution,actor_membership,
    jsonb_build_object('version',expected_version+1));
end;
$$;

create function public.os_cancel_order(
  target uuid,expected_version bigint,justification text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  actor_membership uuid;
  normalized_reason text := btrim(coalesce(justification,''));
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status in ('Concluída','Cancelada') then raise exception 'Cancelamento não permitido no status atual'; end if;
  if length(normalized_reason) not between 3 and 2000 then raise exception 'Justificativa obrigatória'; end if;
  if current_order.status in ('Atribuída','Em atendimento') or
     (current_order.status='Aguardando informação' and
      current_order.resume_status in ('Atribuída','Em atendimento')) then
    if not os_private.can_service_order(current_order) then raise exception 'Acesso negado'; end if;
  elsif not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set status='Cancelada',status_reason=normalized_reason,
    cancelled_at=now(),completed_at=null,version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Cancelada',
    'order_canceled','cancel',normalized_reason,actor_membership,
    jsonb_build_object('version',expected_version+1));
end;
$$;

create function public.os_reopen_order(
  target uuid,expected_version bigint,justification text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  actor_membership uuid;
  normalized_reason text := btrim(coalesce(justification,''));
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status not in ('Concluída','Cancelada') then raise exception 'Reabertura não permitida no status atual'; end if;
  if length(normalized_reason) not between 3 and 2000 then raise exception 'Justificativa obrigatória'; end if;
  if not os_private.is_admin() and not os_private.can_service_order(current_order) then raise exception 'Acesso negado'; end if;
  if not os_private.order_is_reconciled(current_order) then raise exception 'Ordem não conciliada'; end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set status='Em triagem',status_reason=normalized_reason,
    completed_at=null,cancelled_at=null,reopened_at=now(),triaged_at=now(),
    waiting_since=null,waiting_reason=null,waiting_details=null,resume_status=null,
    version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Em triagem',
    'order_reopened','reopen',normalized_reason,actor_membership,
    jsonb_build_object('version',expected_version+1));
end;
$$;

create function public.os_edit_order_controlled(
  target uuid,expected_version bigint,new_title text,new_priority text,
  priority_justification text,detail_patch jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  actor_membership uuid;
  normalized_title text := btrim(coalesce(new_title,''));
  normalized_reason text := btrim(coalesce(priority_justification,''));
begin
  current_order := os_private.lock_order(target,expected_version);
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  if current_order.status in ('Concluída','Cancelada') then raise exception 'Edição não permitida no status atual'; end if;
  if length(normalized_title) not between 3 and 500 or
     new_priority not in ('Baixa','Normal','Alta','Urgente') or
     jsonb_typeof(detail_patch) <> 'object' or length(normalized_reason) > 2000 then
    raise exception 'Dados de edição inválidos';
  end if;
  if new_priority is distinct from current_order.priority and
     length(normalized_reason) not between 3 and 2000 then
    raise exception 'Justificativa da prioridade obrigatória';
  end if;
  actor_membership := os_private.order_actor_membership(current_order);
  update public.os_orders set title=normalized_title,priority=new_priority,
    priority_reason=case when new_priority is distinct from current_order.priority
      then normalized_reason else priority_reason end,
    details=detail_patch,version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,current_order.status,
    'order_edited','edit',normalized_reason,actor_membership,
    jsonb_build_object('priority_changed',new_priority is distinct from current_order.priority,
      'version',expected_version+1));
end;
$$;

revoke all on function os_private.lock_order(uuid,bigint) from public,anon,authenticated;
revoke all on function os_private.order_actor_membership(public.os_orders) from public,anon,authenticated;
revoke all on function os_private.order_has_active_assignee(public.os_orders) from public,anon,authenticated;
revoke all on function os_private.can_service_order(public.os_orders) from public,anon,authenticated;
revoke all on function os_private.record_order_event(uuid,text,text,text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function os_private.reject_order_event_mutation() from public,anon,authenticated;

revoke all on function public.os_open_order(text,uuid,uuid,text,jsonb,uuid,uuid,uuid) from public,anon;
revoke all on function public.os_reconcile_order(uuid,bigint,uuid,uuid,uuid) from public,anon;
revoke all on function public.os_start_triage(uuid,bigint) from public,anon;
revoke all on function public.os_forward_order(uuid,bigint,uuid) from public,anon;
revoke all on function public.os_assign_order(uuid,bigint,uuid) from public,anon;
revoke all on function public.os_reassign_order(uuid,bigint,uuid,text) from public,anon;
revoke all on function public.os_start_service(uuid,bigint) from public,anon;
revoke all on function public.os_add_service_entry(uuid,bigint,text,text,timestamptz) from public,anon;
revoke all on function public.os_wait_for_information(uuid,bigint,text,text) from public,anon;
revoke all on function public.os_resume_service(uuid,bigint) from public,anon;
revoke all on function public.os_complete_order(uuid,bigint,text) from public,anon;
revoke all on function public.os_cancel_order(uuid,bigint,text) from public,anon;
revoke all on function public.os_reopen_order(uuid,bigint,text) from public,anon;
revoke all on function public.os_edit_order_controlled(uuid,bigint,text,text,text,jsonb) from public,anon;

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

commit;
