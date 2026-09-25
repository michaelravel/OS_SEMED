# Evidências e índices da pesquisa de Ordens de Serviço

## Volume observado

- `ABERTURA_OS.xlsx`: 6 linhas físicas, correspondendo ao cabeçalho e 5 registros de abertura.
- `LOGISTICA.xlsx`: 307 linhas físicas, correspondendo ao cabeçalho e 306 registros operacionais.
- O volume remoto não foi consultado nesta etapa. Deve ser medido em homologação antes de promover índices para Production.

Mesmo com o volume importado atual pequeno, a listagem recebe novas linhas durante o uso. A paginação por `(created_at, id)` foi adotada para manter uma ordem total e evitar repetição ou omissão entre páginas quando uma OS é aberta simultaneamente.

## Consulta final

`public.os_search_orders` aplica RLS antes de retornar dados e usa:

- igualdade para protocolo, status, prioridade e relações;
- intervalo semiaberto para períodos de abertura e conclusão;
- `reopened_at is not null` para reabertas;
- estado canônico para aguardando informação;
- `ILIKE` somente no título para busca textual;
- ordenação `created_at desc, id desc`;
- cursor bidirecional usando comparação da mesma tupla.

## Índices reutilizados

| Consulta | Índice existente |
| --- | --- |
| Protocolo exato | `os_orders_protocol_key` |
| Status | `os_orders_status_date` |
| Unidade de origem | `os_orders_unit_date` |
| Unidade executora | `os_orders_destination_unit` |
| Solicitante | `os_orders_author` |
| Responsável | `os_orders_responsible` |
| Título | `os_orders_active_title_trgm` |

## Índice novo

| Índice | Consulta atendida |
| --- | --- |
| `os_orders_active_created_cursor` | ordem padrão e cursor composto |

Não foram criados novos índices para categoria, datas ou reabertura porque o volume observado é pequeno. Também não foi criado índice isolado para prioridade porque o domínio possui apenas quatro valores e apresenta baixa seletividade. Índices adicionais só devem ser considerados após `EXPLAIN (ANALYZE, BUFFERS)` em homologação demonstrar custo relevante.

## Validação em homologação

1. Atualizar estatísticas com `ANALYZE public.os_orders` em janela segura.
2. Executar `EXPLAIN (ANALYZE, BUFFERS)` para a listagem sem filtros e para cada filtro frequente.
3. Confirmar uso dos índices sem forçar `enable_seqscan`; tabelas pequenas devem continuar usando varredura sequencial quando o otimizador considerar mais barato.
4. Comparar latência e leituras antes/depois.
5. Revisar índices não utilizados após um ciclo operacional: `VALIDAR NO PROVEDOR`.
