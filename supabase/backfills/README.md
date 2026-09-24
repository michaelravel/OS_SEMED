# Backfill do fluxo de Ordens de Serviço

Estes arquivos são operacionais e não pertencem ao diretório automático de
migrations. Não os execute primeiro em Production.

## Pré-requisitos em homologação

1. Confirmar backup recente do PostgreSQL e a possibilidade de restauração.
2. Confirmar que as migrations até
   `202609240007_additive_order_flow_schema.sql` foram aplicadas.
3. Usar uma conexão direta com permissão para atualizar `os_orders`, inserir em
   `os_order_events` e `os_audit` e consultar funções de `os_private`.
4. Evitar concorrência com atendimentos durante a execução. O backfill adquire
   bloqueio de escrita consistente em `os_orders` até finalizar a transação.

## Sequência de homologação

1. Executar `202609240008_order_flow_preflight.sql` e salvar toda a saída.
2. Conferir contagem total, distribuição por estado, duplicidades e exceções.
3. Conciliar previamente qualquer duplicidade projetada de protocolo formal.
4. Executar `202609240008_order_flow_backfill.sql` e salvar os relatórios
   `before`, `after`, alterações e exceções.
5. Executar `202609240008_order_flow_validation.sql` e salvar a saída.
6. Executar o backfill uma segunda vez. A quantidade de estados normalizados,
   anos e códigos preenchidos deve ser zero; eventos e exceções não podem ser
   duplicados.
7. Validar na aplicação uma OS de cada estado preservado e mapeado, incluindo
   uma importada com `legacy_id`.

## Regras aplicadas

- `protocol_year` deriva exclusivamente de `opened_at`. Quando essa data não
  existe, o ano permanece nulo e a OS é registrada para conciliação.
- `protocol_code` é a representação decimal exata do `protocol bigint`
  existente. Não há renumeração ou reserva de novos números.
- Valores já preenchidos de protocolo não são sobrescritos.
- Estados legados só são convertidos quando os vínculos exigidos pelas regras
  atuais podem ser confirmados.
- O processo nunca preenche responsável, unidade, vínculo ou datas históricas.
- Cada mudança de estado gera um evento `workflow_backfill` sem ator inventado.
- Exceções são registradas em `os_audit` somente com identificador técnico,
  código da exceção e SQLSTATE quando aplicável.

## Critérios de aprovação

- Contagem total de OS idêntica antes e depois.
- Mesmos `id`, `protocol bigint` e `legacy_id` antes e depois.
- Nenhum protocolo numérico ou formal duplicado.
- Nenhum estado legado restante sem uma exceção explicável.
- Nenhum dado pessoal presente nos relatórios de exceção.
- Segunda execução sem novas alterações, eventos ou exceções duplicadas.

Se qualquer invariante interna falhar, a transação inteira é revertida. Para
falhas de uma OS isolada, essa OS permanece inalterada e aparece no relatório
de conciliação.
