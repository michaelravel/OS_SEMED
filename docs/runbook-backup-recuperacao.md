# OS SEMED — Runbook de backup, recuperação e rollback

**Estado:** proposta operacional inicial  
**Escopo:** PostgreSQL/Supabase, Supabase Storage, migrations e Vercel  
**Regra principal:** nenhuma restauração deve começar em Production. Toda recuperação deve ser ensaiada e validada em um projeto isolado.

## 1. Arquitetura protegida

O OS_SEMED possui quatro partes que precisam permanecer compatíveis:

1. **PostgreSQL/Supabase:** Auth, tabelas `os_*`, vínculos, RLS, funções, triggers, auditoria, histórico de migrations e metadados `storage.*`.
2. **Supabase Storage:** bucket privado `os-attachments`, com objetos binários no caminho `<order_id>/<attachment_id>`.
3. **Aplicação Next.js/Vercel:** código e contrato de banco correspondente a cada deployment.
4. **Configuração externa:** variáveis por ambiente, configurações de Auth, Storage, rede e domínios. Valores secretos não pertencem ao backup do Git.

O registro `public.os_attachments` e a linha em `storage.objects` são metadados. O arquivo binário é armazenado separadamente. O próprio Supabase informa que backups do banco não incluem os objetos do Storage; uma recuperação completa exige banco, arquivos e configuração compatíveis ([Database Backups](https://supabase.com/docs/guides/platform/backups), [Download Objects](https://supabase.com/docs/guides/storage/management/download-objects)).

As migrations locais são transacionais e ficam em `supabase/migrations/`. O CI valida o SQL em PGlite, mas não aplica migrations nem realiza deploy. O projeto Vercel contém somente a configuração `framework: nextjs`; separação efetiva de Development, Preview e Production deve ser confirmada.

> `VALIDAR NO PROVEDOR`: plano atual do Supabase, backups automáticos disponíveis, PITR, retenção, Restore to a New Project, protocolo S3 e permissões da equipe.

> `VALIDAR NO PROVEDOR`: plano atual da Vercel, deployments elegíveis para rollback, branch de Production, atribuição automática de domínio, variáveis de cada ambiente e permissões da equipe.

## 2. Objetivos iniciais

Estes valores são metas operacionais, não garantias dos provedores.

| Item | Proposta inicial | Observação |
| --- | --- | --- |
| RPO rotineiro do banco | 24 horas | Depende de backup diário confirmado ou exportação diária. `VALIDAR NO PROVEDOR` |
| RPO rotineiro dos anexos | 24 horas | Exige cópia diária independente do bucket. |
| RPO antes de migration | 0 horas durante a janela | Suspender escrita, concluir banco + Storage e só então iniciar a migration. |
| RTO da aplicação | 30 minutos | Meta para apontar o domínio ao último deployment compatível. `VALIDAR NO PROVEDOR` |
| RTO de banco + Storage | 4 horas | Meta inicial; medir em simulação com volume real. |
| RTO de desastre amplo | 8 horas | Inclui projeto isolado, banco, Storage, configuração e validação. |

Se o negócio não aceitar perda potencial de até 24 horas, avaliar PITR para o banco e uma rotina de cópia de Storage mais frequente. Disponibilidade, preço e janela de PITR são `VALIDAR NO PROVEDOR`.

## 3. Responsabilidades

| Papel | Responsabilidade |
| --- | --- |
| Responsável pelo incidente | Declara a janela, interrompe deploys, mantém a linha do tempo e decide avançar ou abortar. |
| Operador de recuperação | Possui acesso administrativo ao Supabase, ao cofre de credenciais e ao destino criptografado dos backups. |
| Operador de aplicação | Controla GitHub/Vercel, identifica o último deployment compatível e executa rollback autorizado. |
| Revisor | Confere projeto, data, hashes, contagens, RLS, anexos e evidências antes da liberação. |
| Responsável de negócio | Valida amostras de ordens, usuários, unidades e anexos após a recuperação. |

Nomear uma pessoa principal e uma substituta para cada papel. O operador e o revisor não devem ser a mesma pessoa em Production.

> `VALIDAR NO PROVEDOR`: nomes, contatos, escala, permissões mínimas e segundo fator das contas responsáveis.

## 4. Periodicidade e retenção propostas

| Artefato | Periodicidade | Retenção inicial |
| --- | --- | --- |
| Backup gerenciado do banco | Diário | Conforme plano, nunca presumir. `VALIDAR NO PROVEDOR` |
| Dump lógico independente | Diário e antes de toda migration | 14 diários, 8 semanais e 12 mensais |
| Cópia dos objetos do Storage | Diária e antes de mudança que afete Storage | Mesma retenção do dump correspondente |
| Manifesto e hashes | Em cada execução | Mesmo prazo do conjunto de backup |
| Backup pré-migration | Imediatamente antes da mudança | 90 dias ou até dois testes de recuperação posteriores aprovados |
| Evidências de simulação | Trimestral | 12 meses |

Backups devem ficar criptografados fora do projeto Supabase de origem e fora do repositório Git. Deve existir ao menos uma cópia em domínio administrativo diferente do ambiente de Production. Retenção com dados pessoais precisa ser aprovada conforme a política da SEMED.

> `VALIDAR NO PROVEDOR`: capacidade contratada, região, criptografia, imutabilidade, versionamento e retenção automática do destino externo.

## 5. Convenção do conjunto de backup

Cada execução deve produzir um diretório ou pacote com identificador único:

```text
os-semed-backup/<ambiente>/<AAAA-MM-DDTHH-mm-ssZ>/
  manifest.json
  checksums.sha256
  database/
    roles.sql
    schema.sql
    data.sql
    migration-history-schema.sql
    migration-history-data.sql
  storage/
    os-attachments/
    inventory.csv
  evidence/
    preflight.txt
    counts.txt
    versions.txt
```

O manifesto deve conter, sem secrets:

- ambiente e referência do projeto;
- data/hora UTC de início e fim;
- responsável e revisor;
- commit Git e deployment Vercel atual;
- versões de PostgreSQL, Supabase CLI e cliente de Storage;
- migrations registradas no banco;
- contagens das tabelas `os_*`;
- quantidade e bytes dos anexos no banco, em `storage.objects` e na cópia;
- algoritmo e hashes dos arquivos;
- resultado da verificação;
- observações e falhas.

Nunca registrar senhas, connection strings, tokens, chaves `service_role`, chaves S3 ou conteúdo de dados pessoais no manifesto ou nos logs.

## 6. Runbook — backup do banco

### 6.1 Preparação

1. Confirmar visualmente que o projeto selecionado é o ambiente correto.
2. Registrar commit, deployment atual, horário UTC e operador.
3. Bloquear novas migrations e deploys durante o backup.
4. Para um checkpoint coordenado com Storage, estabelecer uma janela sem escrita. A aplicação ainda não possui modo de manutenção; o mecanismo temporário é `VALIDAR NO PROVEDOR`.
5. Executar `supabase/preflight.sql`, que contém somente consultas, e salvar a saída sem credenciais.
6. Conferir no Dashboard se há backup gerenciado recente e restaurável.

> `VALIDAR NO PROVEDOR`: existência, horário, tipo, retenção e estado do último backup gerenciado; PITR não deve ser presumido.

### 6.2 Exportação lógica independente

Usar uma estação controlada, com disco criptografado, Supabase CLI e PostgreSQL/`psql` em versões compatíveis. A documentação oficial recomenda exportar papéis, schema e dados separadamente ([Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)).

Modelo de comandos, para execução futura pelo operador:

```sh
supabase db dump --db-url "<CONNECTION_STRING>" -f roles.sql --role-only
supabase db dump --db-url "<CONNECTION_STRING>" -f schema.sql
supabase db dump --db-url "<CONNECTION_STRING>" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
supabase db dump --db-url "<CONNECTION_STRING>" -f migration-history-schema.sql --schema supabase_migrations
supabase db dump --db-url "<CONNECTION_STRING>" -f migration-history-data.sql --use-copy --data-only --schema supabase_migrations
```

Cuidados:

- obter a conexão no painel, sem salvá-la no Git, scripts ou histórico compartilhado;
- preferir o pooler de sessão quando indicado pelo Supabase;
- não usar `db reset`, `DROP`, limpeza ou sobrescrita;
- não assumir que o dump lógico preserva chaves internas de criptografia, configurações de Auth ou objetos do Storage;
- exportar customizações de `auth` e `storage` conforme a versão do mecanismo de diff. `VALIDAR NO PROVEDOR`;
- criptografar o conjunto antes de enviá-lo ao destino externo.

### 6.3 Verificação do backup do banco

1. Confirmar que todos os arquivos existem e têm tamanho maior que zero.
2. Gerar SHA-256 e registrar no manifesto.
3. Comparar contagens por tabela com `counts.txt`.
4. Confirmar que o histórico inclui todas as migrations esperadas do repositório.
5. Restaurar o conjunto em um projeto Supabase isolado e descartável, nunca em Production.
6. Executar as verificações da seção 10.
7. Marcar o backup como **válido** somente após o ensaio de restauração.

## 7. Runbook — backup dos anexos

### 7.1 Inventário

Coletar, na mesma janela do backup do banco:

- linhas de `public.os_attachments`;
- objetos do bucket `os-attachments` em `storage.objects`;
- lista recursiva dos objetos binários, com caminho, tamanho, data e hash quando disponível.

Os três conjuntos devem corresponder pelo caminho armazenado. Divergências ficam registradas como:

- metadado da aplicação sem objeto;
- objeto sem metadado da aplicação;
- tamanho divergente;
- objeto não legível;
- hash divergente.

### 7.2 Cópia

Método preferido: cópia recursiva para armazenamento externo criptografado usando Supabase CLI ou cliente S3 compatível. O Supabase documenta ambas as opções e recomenda cliente S3 para grandes volumes ([Download Objects](https://supabase.com/docs/guides/storage/management/download-objects)).

Modelo com CLI, cuja sintaxe deve ser confirmada na versão instalada:

```sh
supabase link --project-ref <PROJECT_REF>
supabase storage ls ss:///os-attachments -r --linked --experimental
supabase storage cp ss:///os-attachments <DIRETORIO_LOCAL>/os-attachments -r --linked --experimental
```

> `VALIDAR NO PROVEDOR`: disponibilidade e estabilidade dos comandos experimentais da CLI, limite de listagem, paginação e suporte a download recursivo na versão instalada.

Alternativa para grande volume: S3 compatível com `rclone`, AWS CLI ou ferramenta equivalente.

> `VALIDAR NO PROVEDOR`: protocolo S3 habilitado, endpoint, região, permissões somente leitura e processo seguro de emissão/rotação das chaves.

### 7.3 Verificação

1. Comparar quantidade e soma de bytes entre inventário e cópia.
2. Calcular SHA-256 de cada arquivo copiado e do inventário.
3. Selecionar amostras de PDF, imagem, planilha, documento e texto e verificar abertura.
4. Confirmar que nenhum caminho escapou do prefixo esperado.
5. Confirmar que o backup não ficou publicamente acessível.
6. Associar o inventário ao mesmo identificador do backup do banco.

## 8. Runbook — restauração do banco

### 8.1 Regra de segurança

Restauração em Production é proibida neste runbook. Primeiro criar ou selecionar um projeto isolado de recuperação, sem domínio de Production e sem usuários externos. Funções que possam realizar chamadas externas, webhooks, cron jobs e integrações devem permanecer desativadas até a inspeção.

O recurso do Supabase para restaurar em novo projeto pode depender do plano, de backups físicos e de custos; também pode iniciar extensões com efeitos externos. `VALIDAR NO PROVEDOR` ([Restore to a New Project](https://supabase.com/docs/guides/platform/clone-project)).

### 8.2 Opção A — restauração gerenciada em projeto novo

1. Selecionar um ponto anterior ao incidente.
2. Criar a cópia em projeto novo pelo fluxo oficial.
3. Não apontar Vercel ou domínios para esse projeto.
4. Revisar extensões, rede, Auth, chaves, webhooks, Realtime e configurações.
5. Restaurar os binários do Storage separadamente.
6. Executar a verificação pós-restauração.

> `VALIDAR NO PROVEDOR`: elegibilidade, custo, região, janela disponível, indisponibilidade, cópia da chave raiz de criptografia e itens não transferidos.

### 8.3 Opção B — dump lógico em projeto novo

Criar um projeto vazio e usar o procedimento oficial com transação única e interrupção no primeiro erro:

```sh
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "<NOVA_CONNECTION_STRING>"
```

Depois, restaurar o histórico de migrations conforme o guia oficial. Não ignorar erros automaticamente. Erros de objetos gerenciados, proprietário ou papéis devem ser avaliados individualmente e documentados.

> `VALIDAR NO PROVEDOR`: compatibilidade da versão PostgreSQL, extensões, Auth, chave raiz de criptografia e customizações dos schemas gerenciados.

## 9. Runbook — restauração do Storage

1. Restaurar e validar primeiro o banco no projeto isolado.
2. Confirmar que o bucket privado `os-attachments`, limites e tipos MIME correspondem às migrations.
3. Confirmar as políticas RLS de `storage.objects`.
4. Copiar os objetos do backup para o bucket, preservando exatamente os caminhos.
5. Não tornar o bucket público durante a recuperação.

Modelo de upload futuro com CLI:

```sh
supabase link --project-ref <NOVO_PROJECT_REF>
supabase storage cp <DIRETORIO_LOCAL>/os-attachments ss:///os-attachments -r --linked --experimental
```

A documentação oficial usa esse fluxo para copiar arquivos baixados a um novo projeto ([recuperação de objetos do Storage](https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause)). A versão da CLI e as opções continuam `VALIDAR NO PROVEDOR`.

Se a ferramenta indicar conflito porque o dump já restaurou linhas em `storage.objects`, interromper a operação. Não apagar nem editar manualmente esses metadados. Validar em projeto isolado se a versão atual da CLI consegue repor o binário sobre o metadado existente ou se deve ser usado o fluxo S3 recomendado pelo provedor.

Após a cópia:

1. repetir o inventário;
2. comparar quantidade, bytes e hashes;
3. testar downloads assinados com usuários autorizados;
4. confirmar que usuário anônimo e usuário de outra unidade não acessam o arquivo;
5. registrar objetos ausentes ou excedentes sem excluí-los automaticamente.

## 10. Verificação pós-restauração

### Banco e migrations

- todas as migrations esperadas constam no histórico;
- tabelas, PKs, FKs, constraints, índices, triggers, funções e bucket existem;
- RLS está habilitada em todas as tabelas `os_*`;
- grants de `anon`, `authenticated` e `service_role` correspondem às migrations;
- não há administrador ausente nem mais permissões que na origem;
- contagens batem com o manifesto ou possuem diferença explicada;
- protocolos de OS permanecem únicos;
- auditoria e `os_order_events` estão presentes;
- timestamps e sequência de protocolo continuam válidos.

### Auth e autorização

- login e logout funcionam com contas de teste;
- admin, gestor, solicitante e responsável veem apenas o escopo esperado;
- usuário sem vínculo recebe bloqueio;
- isolamento entre duas unidades é confirmado;
- RPCs rejeitam transições inválidas e alterações diretas;
- anônimo não lê tabelas nem anexos.

### Storage

- bucket continua privado;
- metadados e binários correspondem;
- amostras de todos os tipos permitidos abrem corretamente;
- URL assinada expira e não é reutilizada como URL pública;
- não há anexos órfãos sem registro no relatório.

### Aplicação

- configurar somente variáveis do ambiente isolado;
- executar TypeScript, lint, testes e build;
- publicar Preview conectado ao projeto restaurado;
- testar login, painel, listagem, busca por protocolo, abertura, atribuição, status, histórico, mensagem e anexo;
- revisar logs sem expor dados pessoais ou secrets;
- registrar horário, resultado, responsável e evidências.

## 11. Rollback da aplicação

Rollback de Vercel troca o código servido, mas não desfaz schema, dados, Storage ou variáveis. Uma versão antiga da aplicação só pode voltar se for compatível com o banco atual.

Procedimento:

1. interromper novos deploys;
2. identificar o último deployment saudável e o commit correspondente;
3. conferir a matriz de compatibilidade aplicação × migration;
4. se o banco continua compatível, executar Instant Rollback ou promover o deployment saudável;
5. verificar domínio, login, rotas principais e logs;
6. registrar o deployment anterior, o restaurado e o horário;
7. corrigir em branch, validar em Preview e somente depois promover novamente.

A Vercel informa que o Instant Rollback reaponta o tráfego sem rebuild, não reverte banco nem atualiza variáveis, e a elegibilidade de deployments varia conforme plano ([Instant Rollback](https://vercel.com/docs/instant-rollback), [Rollback Production](https://vercel.com/docs/deployments/rollback-production-deployment)).

> `VALIDAR NO PROVEDOR`: deployments elegíveis, limite do plano, permissões, variáveis que estavam ativas, aliases e comportamento de auto-assign após rollback.

## 12. Tratamento de falha de migration

### Antes de aplicar

- backup do banco validado;
- backup do Storage validado;
- commit e deployment anterior registrados;
- migration executada em clone/homologação com cópia representativa;
- queries de verificação e critério de abortar definidos;
- aplicação nova construída e testada;
- compatibilidade reversa declarada;
- janela sem escrita e responsáveis presentes.

### Falha dentro da transação

As migrations atuais usam `begin`/`commit`. Se houver erro antes do `commit`:

1. não repetir automaticamente;
2. salvar a mensagem sem secrets;
3. confirmar que a transação foi revertida;
4. comparar schema e histórico com o preflight;
5. manter a aplicação anterior;
6. corrigir a migration em novo arquivo ou conforme a política aprovada; não editar migration já aplicada em outro ambiente;
7. repetir primeiro em ambiente isolado.

### Falha após commit

1. suspender escrita e deploys;
2. não executar comandos manuais de exclusão ou rollback improvisado;
3. determinar se a falha é somente da aplicação, somente do banco ou incompatibilidade entre ambos;
4. preferir uma migration corretiva aditiva quando os dados estão íntegros;
5. restaurar o deployment anterior somente se ele for compatível com o schema novo;
6. se houver corrupção ou perda, restaurar o backup em projeto isolado, comparar e preparar recuperação seletiva;
7. restauração completa de Production exige plano aprovado, janela comunicada e autorização explícita.

### Critérios de abortar a mudança

- backup ou hashes incompletos;
- Storage não inventariado;
- projeto/ambiente não confirmado;
- migration remota divergente da testada;
- redução inesperada de contagens;
- RLS desabilitada ou políticas ausentes;
- falha de login ou isolamento entre unidades;
- anexos inacessíveis;
- aplicação anterior incompatível e ausência de estratégia de avanço.

## 13. Simulações e melhoria contínua

Executar trimestralmente uma simulação completa em ambiente isolado:

1. selecionar o conjunto de backup mais recente;
2. restaurar banco e Storage;
3. medir tempos de cada etapa;
4. executar todo o checklist pós-restauração;
5. registrar RPO e RTO realmente obtidos;
6. corrigir runbook, permissões e automação;
7. confirmar que duas pessoas conseguem executar o processo.

O primeiro ensaio deve ocorrer antes da próxima migration em Production. Até que o ensaio passe, o backup deve ser tratado como **não comprovado**.

## 14. Registro da operação

Cada backup, restauração simulada, rollback ou falha de migration deve registrar:

- identificador do incidente/mudança;
- ambiente;
- início e fim UTC;
- pessoas e aprovações;
- backup utilizado e hashes;
- ponto de recuperação escolhido;
- commit, deployment e migrations;
- ações executadas;
- resultados e divergências;
- RPO/RTO obtidos;
- decisão de liberar, manter isolado ou abortar.

O registro não deve conter secrets, connection strings, tokens, conteúdo de anexos ou dados pessoais desnecessários.
