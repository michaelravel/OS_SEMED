-- pg-delta: transaction=false
-- Rollback apenas dos índices da migration 202609240006.
-- pg_trgm não é removida porque pode ser compartilhada por outros objetos.
-- Recria primeiro a cobertura da FK de anexos e só então remove o substituto.
create index concurrently if not exists os_attachments_order
  on public.os_attachments(order_id);
drop index concurrently if exists public.os_attachments_order_date;
drop index concurrently if exists public.os_orders_active_title_trgm;
drop index concurrently if exists public.os_units_name_trgm;
drop index concurrently if exists public.os_catalogs_name_trgm;
drop index concurrently if exists public.os_orders_active_created_at;
drop index concurrently if exists public.os_units_name;
drop index concurrently if exists public.os_profiles_name;
drop index concurrently if exists public.os_catalogs_active_name;
