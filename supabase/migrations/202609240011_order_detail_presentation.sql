-- Projeção segura para o cabeçalho da OS. Evita ampliar SELECT em perfis e
-- unidades; somente leitores da ordem recebem os nomes necessários à tela.
begin;

create function public.os_order_header(target uuid)
returns table(
  category_name text,
  requester_name text,
  origin_unit_name text,
  destination_unit_name text,
  responsible_name text
)
language sql stable security definer set search_path = '' as $$
  select
    c.name,
    requester.name,
    origin_unit.name,
    destination_unit.name,
    case
      when os_private.can_read_order_internal(o) then responsible.name
      else null
    end
  from public.os_orders o
  left join public.os_catalogs c on c.id=o.category_id
  left join public.os_profiles requester on requester.id=o.opened_by
  left join public.os_units origin_unit on origin_unit.id=o.unit_id
  left join public.os_units destination_unit on destination_unit.id=o.destination_unit_id
  left join public.os_profiles responsible on responsible.id=o.responsible_id
  where o.id=target and os_private.can_read_order(o);
$$;

revoke all on function public.os_order_header(uuid) from public,anon;
grant execute on function public.os_order_header(uuid) to authenticated;

commit;
