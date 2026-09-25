-- Consulta segura e estável da listagem de Ordens de Serviço.
-- A paginação usa a chave total (created_at,id), evitando repetição ou omissão
-- quando novas ordens são abertas entre duas páginas.
begin;

create function public.os_order_filter_options()
returns table(option_kind text,option_id uuid,option_name text)
language sql stable security definer set search_path = '' as $$
  with visible_orders as materialized (
    select o.* from public.os_orders o
    where o.active and os_private.can_read_order(o)
  ), options(option_kind,option_id,option_name) as (
    select 'category'::text,c.id,c.name
    from visible_orders o join public.os_catalogs c on c.id=o.category_id
    union
    select 'origin_unit',u.id,u.name
    from visible_orders o join public.os_units u on u.id=o.unit_id
    union
    select 'destination_unit',u.id,u.name
    from visible_orders o join public.os_units u on u.id=o.destination_unit_id
    union
    select 'requester',p.id,p.name
    from visible_orders o join public.os_profiles p on p.id=o.opened_by
    union
    select 'responsible',p.id,p.name
    from visible_orders o join public.os_profiles p on p.id=o.responsible_id
    where os_private.can_read_order_internal(o)
  )
  select options.* from options order by option_kind,option_name,option_id;
$$;

create function public.os_search_orders(
  search_text text,
  target_protocol bigint,
  target_protocol_code text,
  target_protocol_year integer,
  target_status text,
  target_priority text,
  target_category uuid,
  target_origin_unit uuid,
  target_destination_unit uuid,
  target_requester uuid,
  target_responsible uuid,
  opened_from timestamptz,
  opened_until timestamptz,
  completed_from timestamptz,
  completed_until timestamptz,
  only_reopened boolean,
  only_waiting boolean,
  cursor_created_at timestamptz,
  cursor_id uuid,
  cursor_direction text,
  page_size integer
) returns table(
  id uuid,
  protocol bigint,
  protocol_year integer,
  protocol_code text,
  title text,
  status text,
  priority text,
  created_at timestamptz,
  has_previous boolean,
  has_next boolean
) language plpgsql stable security definer set search_path = '' as $$
declare
  normalized_search text := nullif(btrim(search_text),'');
  normalized_direction text := coalesce(cursor_direction,'next');
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if page_size not between 1 and 100 or
     normalized_direction not in ('next','previous') or
     ((cursor_created_at is null) <> (cursor_id is null)) or
     length(coalesce(normalized_search,'')) > 100 or
     length(coalesce(target_protocol_code,'')) > 50 then
    raise exception 'Filtros de pesquisa inválidos';
  end if;

  return query
  with base as materialized (
    select o.id,o.protocol,o.protocol_year,o.protocol_code,o.title,
      o.status,o.priority,o.created_at
    from public.os_orders o
    where o.active and os_private.can_read_order(o)
      and (normalized_search is null or o.title ilike
        '%' || replace(replace(normalized_search,'%','\%'),'_','\_') || '%' escape '\')
      and (target_protocol is null or o.protocol=target_protocol)
      and (target_protocol_code is null or (
        o.protocol_code=target_protocol_code and o.protocol_year=target_protocol_year
      ))
      and (target_status is null or o.status=target_status)
      and (target_priority is null or o.priority=target_priority)
      and (target_category is null or o.category_id=target_category)
      and (target_origin_unit is null or o.unit_id=target_origin_unit)
      and (target_destination_unit is null or
        o.destination_unit_id=target_destination_unit)
      and (target_requester is null or o.opened_by=target_requester)
      and (target_responsible is null or o.responsible_id=target_responsible)
      and (opened_from is null or o.opened_at>=opened_from)
      and (opened_until is null or o.opened_at<opened_until)
      and (completed_from is null or o.completed_at>=completed_from)
      and (completed_until is null or o.completed_at<completed_until)
      and (not coalesce(only_reopened,false) or o.reopened_at is not null)
      and (not coalesce(only_waiting,false) or o.status='Aguardando informação')
  ), candidates as materialized (
    select b.* from base b
    where cursor_created_at is null or
      (normalized_direction='next' and
       (b.created_at,b.id)<(cursor_created_at,cursor_id)) or
      (normalized_direction='previous' and
       (b.created_at,b.id)>(cursor_created_at,cursor_id))
    order by
      case when normalized_direction='previous' then b.created_at end asc,
      case when normalized_direction='previous' then b.id end asc,
      case when normalized_direction='next' then b.created_at end desc,
      case when normalized_direction='next' then b.id end desc
    limit page_size+1
  ), page_rows as (
    select c.* from candidates c
    order by
      case when normalized_direction='previous' then c.created_at end asc,
      case when normalized_direction='previous' then c.id end asc,
      case when normalized_direction='next' then c.created_at end desc,
      case when normalized_direction='next' then c.id end desc
    limit page_size
  ), page_state as (
    select count(*)>page_size as has_extra from candidates
  )
  select p.id,p.protocol,p.protocol_year,p.protocol_code,p.title,p.status,
    p.priority,p.created_at,
    case when normalized_direction='previous'
      then s.has_extra else cursor_created_at is not null end,
    case when normalized_direction='previous'
      then cursor_created_at is not null else s.has_extra end
  from page_rows p cross join page_state s
  order by p.created_at desc,p.id desc;
end;
$$;

revoke all on function public.os_order_filter_options() from public,anon;
revoke all on function public.os_search_orders(
  text,bigint,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,
  timestamptz,timestamptz,timestamptz,timestamptz,boolean,boolean,
  timestamptz,uuid,text,integer
) from public,anon;
grant execute on function public.os_order_filter_options() to authenticated;
grant execute on function public.os_search_orders(
  text,bigint,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,
  timestamptz,timestamptz,timestamptz,timestamptz,boolean,boolean,
  timestamptz,uuid,text,integer
) to authenticated;

commit;
