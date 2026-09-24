# Anexos — upload, inspeção e reconciliação

## Garantias mantidas

O bucket `os-attachments` permanece privado. O download continua passando pela rota autenticada `/anexos/[id]`, que gera URL assinada por 60 segundos e usa `Cache-Control: private, no-store`. Um objeto só pode ser lido quando existe metadado `ready`, não rejeitado, ligado a uma OS visível para o usuário.

## Limites

A fonte operacional é `os_private.attachment_policy`, consultada pela aplicação por `os_attachment_policy()` e aplicada ao bucket pela migration:

- 3 MiB por arquivo;
- 20 anexos por OS;
- 30 MiB por OS;
- 15 MiB por usuário em cada OS;
- PDF, JPEG, PNG, WebP, TXT, CSV, XLSX e DOCX.

Alterar esses valores exige migration que atualize a política, o bucket, os testes e qualquer constraint relacionada. Não alterar apenas a interface.

## Fluxo transacional compensável

1. O servidor normaliza o nome, valida MIME, extensão, assinatura básica e tamanho, e calcula SHA-256.
2. `os_begin_attachment_upload()` bloqueia a OS durante a reserva, verifica autorização e cotas e cria metadado `pending`.
3. A policy do Storage aceita somente o caminho reservado `<order_id>/<attachment_id>` do próprio usuário.
4. O binário é enviado sem `upsert`.
5. `os_complete_attachment_upload()` confirma que o objeto existe e marca o metadado `ready`.
6. Se o envio falhar e o objeto não existir, `os_abort_attachment_upload()` remove a reserva. Se o resultado for ambíguo e o objeto existir, mantém `unverified` para reconciliação.

Uma falha de finalização nunca apaga automaticamente um objeto que possa ter sido gravado. Metadados `pending` ou `unverified` e objetos sem metadado ficam indisponíveis para download até revisão.

## Reconciliação

Executar como administrador, primeiro em ambiente de homologação:

```sql
select * from public.os_attachment_reconciliation();
```

Possíveis resultados:

- `metadata_without_object`: há registro no banco, mas o objeto não existe;
- `object_without_metadata`: há objeto no bucket sem registro da aplicação;
- `upload_not_finalized`: objeto e metadado existem, mas o fluxo não terminou;
- `size_mismatch`: tamanho registrado e tamanho informado pelo Storage divergem.

Para um metadado existente, depois de verificar o binário e o contexto da OS:

```sql
select public.os_reconcile_attachment('<ATTACHMENT_UUID>');
```

A operação marca `missing`, `quarantined` ou `ready`; não exclui objetos. Objetos sem metadado devem ser investigados pelo caminho, logs e backup. A exclusão exige procedimento administrativo separado, evidência e confirmação humana. Nunca executar remoção em lote diretamente a partir do relatório.

## Preparação para inspeção de conteúdo

Cada registro possui SHA-256, `inspection_status`, `inspected_at` e `quarantined_at`. Novos arquivos começam como `not_scanned`. Uma integração futura pode adotar `pending`, `clean`, `rejected` ou `error` e mover o anexo para `quarantined` quando necessário.

Nenhum antimalware externo está configurado. Antes de integrar um serviço, definir fornecedor, custos, retenção, região, tratamento de dados pessoais, credenciais, timeout e comportamento em falha. A integração deve usar uma operação privilegiada específica e nunca expor o binário publicamente.
