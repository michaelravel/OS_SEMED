# Plano de migração da integridade estrutural

## Diagnóstico dos dados disponíveis

A análise foi feita nos arquivos versionados e no conjunto de importação local;
nenhuma consulta foi executada no Supabase remoto.

- 93 unidades, sem nomes duplicados após normalização simples.
- 51 motoristas, com identificadores e nomes únicos na fonte.
- 112 rotas, com identificadores únicos; existe um nome de rota repetido.
- 65 veículos e 59 placas distintas; existem 6 placas duplicadas.
- 5 ordens importadas. Todas possuem unidade com correspondência única.
- 4 ordens possuem uma categoria logística com correspondência única por
  área, natureza e tipo. Uma ordem permanece sem categoria conciliável.
- Nenhuma das 5 ordens importadas possui motorista, placa ou rota preenchidos.
- Solicitante e responsável existem apenas como texto na origem. Nenhuma conta
  ou vínculo foi inferido a partir desses nomes.

`os_import_records` continua sendo o arquivo imutável e integral da origem.
`os_orders.details` permanece como metadado operacional e área de conciliação.
As chaves `driver`, `vehicle` e `route` deixam de ser referências em JSON assim
que uma relação válida é criada; referências inválidas permanecem visíveis para
tratamento manual.

## Pré-validação obrigatória

Antes de promover a migration, executar as consultas abaixo em uma cópia ou
janela somente leitura e arquivar apenas as contagens, sem exportar dados
pessoais:

```sql
select count(*) from public.os_orders;
select status,count(*) from public.os_orders group by status order by status;

select kind,lower(btrim(data ->> case kind
  when 'drivers' then 'driverId'
  when 'vehicles' then 'plate'
  when 'routes' then 'routeId' end)) as business_key,count(*)
from public.os_catalogs
where kind in ('drivers','vehicles','routes')
group by kind,business_key having count(*) > 1;

select count(*) from public.os_orders o
join public.os_catalogs c on c.id=o.category_id
where c.kind <> 'logistics';

select count(*) from public.os_orders o
left join public.os_import_records r
  on r.source='seed/ABERTURA_OS' and r.source_id=o.legacy_id
where o.legacy_id is not null and r.source_id is null;
```

## Ordem segura de promoção

1. Gerar e verificar backup do banco conforme o runbook existente.
2. Executar as consultas de pré-validação em Preview/Staging.
3. Aplicar `202609240005_order_relational_integrity.sql` em Preview/Staging.
4. Conferir as contagens pós-migração e as OS ainda marcadas `A conferir`.
5. Executar a suíte de RLS contra o schema migrado.
6. Publicar a aplicação compatível com as novas colunas.
7. Repetir backup e pré-validação antes de Production.
8. Aplicar a migration em Production em janela controlada e publicar a
   aplicação imediatamente depois.

A migration é aditiva e aceita a aplicação anterior durante a transição: UUIDs
válidos recebidos nas antigas chaves de `details` são promovidos pelo trigger.
A aplicação nova depende das colunas relacionais, portanto o banco deve ser
promovido antes do deploy da aplicação.

## Backfill e conciliação

- Motorista, veículo e rota: promover somente UUID que exista no catálogo do
  tipo esperado; remover a chave correspondente de `details` após o vínculo.
- Categoria: preencher somente quando área, natureza e tipo produzirem uma
  única correspondência. Não usar aproximação por texto.
- Solicitante e responsável: vincular ao registro exato de `os_memberships`.
  Nomes importados não criam usuários automaticamente.
- Unidade: preservar a FK atual e bloquear novos nomes administrativos
  duplicados, sem tentar fundir registros existentes.
- Placas duplicadas: manter os seis pares legados e conciliá-los manualmente.
  Depois da conciliação completa, uma migration futura poderá converter o
  índice de busca em índice único.
- Categoria incompatível já existente: a nova FK é criada `NOT VALID`, mas
  passa a proteger todas as linhas novas ou alteradas. Validá-la em migration
  posterior somente quando a consulta de inconsistências retornar zero.

## Verificação pós-migração

```sql
select count(*) filter(where import_source is not null) as linked_imports,
       count(*) filter(where category_id is null) as pending_category,
       count(*) filter(where opened_by is null) as pending_requester
from public.os_orders where legacy_id is not null;

select count(*) from public.os_orders
where details ?| array['driver','vehicle','route'];

select conname,convalidated from pg_constraint
where conrelid='public.os_orders'::regclass order by conname;
```

## Rollback

O rollback manual está em
`supabase/rollbacks/202609240005_order_relational_integrity.sql`. Antes de
remover as colunas, ele devolve motorista, veículo, rota e proveniência para
`details`. `legacy_id`, os usuários e o arquivo integral em
`os_import_records` são preservados. O rollback deve ser ensaiado em
Preview/Staging e nunca executado em Production sem backup e decisão formal.
