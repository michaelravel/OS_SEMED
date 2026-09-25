-- pg-delta: transaction=false
-- Índices usados pela consulta public.os_search_orders. Devem ser aplicados
-- separadamente e de forma concorrente após validar o plano em homologação.
-- Reutilizados sem duplicação: os_orders_status_date (status),
-- os_orders_unit_date (origem), os_orders_author (solicitante),
-- os_orders_destination_unit (executora), os_orders_responsible (responsável),
-- os_orders_protocol_key (protocolo) e
-- os_orders_active_title_trgm (texto). Prioridade não recebe índice isolado
-- por possuir baixa cardinalidade e não reduzir seletivamente a consulta.

-- Ordenação e cursor padrão de toda listagem ativa.
create index concurrently if not exists os_orders_active_created_cursor
  on public.os_orders(created_at desc,id desc) where active;

-- O volume importado observado é pequeno. Categoria, períodos e reabertura
-- permanecem sem novos índices até que EXPLAIN em homologação demonstre ganho;
-- criar um índice para cada filtro agora apenas aumentaria o custo de escrita.
