-- pg-delta: transaction=false
-- Índices vinculados às consultas reais da aplicação em 2026-09-24.
-- Esta migration não altera dados nem policies e deve ser aplicada separadamente.
-- Os índices são concorrentes para reduzir bloqueio de escrita em produção.

-- /ordens: busca contém em title com active=true.
-- /unidades e /cadastros/[kind]: busca contém em name.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index concurrently if not exists os_orders_active_title_trgm
  on public.os_orders using gin(title extensions.gin_trgm_ops)
  where active;
create index concurrently if not exists os_units_name_trgm
  on public.os_units using gin(name extensions.gin_trgm_ops);
create index concurrently if not exists os_catalogs_name_trgm
  on public.os_catalogs using gin(name extensions.gin_trgm_ops);

-- /ordens e /painel: active=true order by created_at desc.
-- Também oferece um índice menor para as contagens exatas de OS ativas.
create index concurrently if not exists os_orders_active_created_at
  on public.os_orders(created_at desc)
  where active;

-- /ordens/nova e seletores administrativos: order by name.
create index concurrently if not exists os_units_name on public.os_units(name);
create index concurrently if not exists os_profiles_name on public.os_profiles(name);
create index concurrently if not exists os_catalogs_active_name
  on public.os_catalogs(name)
  where active;

-- /ordens/[id]: anexos por order_id, mais recentes primeiro.
-- O prefixo order_id continua cobrindo a FK e os somatórios de quota por OS.
create index concurrently if not exists os_attachments_order_date
  on public.os_attachments(order_id,created_at desc);
drop index concurrently if exists public.os_attachments_order;
