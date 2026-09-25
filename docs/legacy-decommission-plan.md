# Plano de desativação segura do fluxo legado

Este plano documenta mecanismos preservados durante a finalização do novo fluxo. Nenhum item abaixo deve ser removido antes do período de observação e da conciliação dos registros históricos.

## Inventário ainda existente

### Código TypeScript

- `src/lib/domain.ts`: `statuses`, `orderStatuses`, `progressStatuses` e `advanceOrderSchema` mantêm o contrato antigo.
- `src/lib/order-workflow.ts`: `legacyOrderStatusNames`, `legacyOnlyOrderStatuses`, `compatibleOrderStatuses` e `normalizeOrderStatus` permitem ler estados históricos.
- `src/app/actions/orders.ts`: `changeStatus`, `editOrderDetails` e `updateOrderLinksLegacy` continuam disponíveis, embora as telas atuais usem as operações específicas.
- `src/app/actions.ts`: ainda exporta as três actions legadas para não romper consumidores não localizados no frontend atual.
- `src/lib/database.types.ts`: mantém `os_change_status`, `os_edit_order` e a assinatura antiga de `os_assign_order`.

### Banco de dados

- Estados preservados: `Em análise`, `Em execução`, `Aguardando material` e `Aguardando deslocamento/logística`.
- RPCs preservadas: `os_change_status(uuid,text,text)`, `os_edit_order(uuid,text,text,jsonb)` e a assinatura legada de `os_assign_order`.
- Regras e constraints aceitam estados antigos para que registros importados continuem legíveis e conciliáveis.

### Interface

- Não existe mais seletor genérico de status nem componente exclusivo do fluxo antigo.
- `OrderCycle`, `OrderHeader`, `OrderSummary` e a listagem continuam tratando estados e protocolos legados. Essa compatibilidade ainda é necessária enquanto houver registros antigos.

### Testes

- `tests/rls.test.mjs` cobre as RPCs e transições legadas.
- `tests/order-workflow.test.mjs`, `tests/order-presentation.test.mjs` e `tests/order-flow-backfill.test.mjs` validam o mapeamento dos quatro estados antigos.

## Período de observação

1. Aplicar as migrations em homologação e executar o backfill já preparado.
2. Monitorar por pelo menos 30 dias ou por um ciclo operacional completo, o que for maior.
3. Confirmar que nenhuma tela atual chama as actions legadas por testes estáticos e telemetria server-side.
4. Verificar uso das RPCs antigas em logs do PostgreSQL ou `pg_stat_statements`: `VALIDAR NO PROVEDOR`.
5. Contabilizar semanalmente registros ainda presentes nos quatro estados legados e exceções pendentes de conciliação.

## Critérios para remoção

- Zero registros ativos em estados legados.
- Zero chamadas às RPCs antigas durante todo o período de observação.
- Nenhum consumidor externo identificado usando as assinaturas antigas.
- Backups do banco e dos anexos validados antes da migration de remoção.
- Testes do fluxo canônico, RLS, concorrência e rollback aprovados em homologação.

## Sequência de desativação

1. Remover os exports de `changeStatus`, `editOrderDetails` e `updateOrderLinksLegacy` após confirmar ausência de consumidores.
2. Remover as actions e os schemas TypeScript exclusivos do fluxo antigo.
3. Remover as assinaturas antigas de `os_change_status`, `os_edit_order` e `os_assign_order` em migration separada e reversível.
4. Restringir o check de status aos estados canônicos somente depois de migrar ou arquivar todos os registros legados.
5. Manter `normalizeOrderStatus` por mais uma versão para leitura de artefatos e histórico; removê-lo apenas quando os dados históricos não dependerem mais dos rótulos antigos.
6. Atualizar tipos, testes e documentação e repetir a suíte completa.

## Rollback

Cada remoção deve ser publicada em migration própria. O rollback deve recriar primeiro as RPCs e o check compatível, depois restaurar os exports TypeScript. Não reintroduzir escrita genérica de status na interface.
