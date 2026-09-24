# OS SEMED — migração Next.js / Supabase / Vercel

## Destinos confirmados

- Supabase: `https://ouixjkqcuqpfmhmmsdxg.supabase.co`
- Vercel: `https://os-semed.vercel.app/`
- GitHub: `michaelrave1/OS_SEMED`
- Referência visual: projeto local SIGMA, `src/app/globals.css`, `src/components/layout/sidebar.tsx` e `header.tsx`.

Azul `#06215f`, destaque `#6ee000`, tokens HSL, fonte Segoe UI, menu lateral, cabeçalho e cartões seguem a identidade encontrada. Nenhum código de autenticação, dado ou segredo do SIGMA foi copiado.

## O que está implementado localmente

Next.js 16.3.6/App Router, React, TypeScript estrito, cliente Supabase tipado, sessão SSR validada no servidor, proxy de renovação de cookies e Server Actions com validação Zod. Sem armazenamento de dados pessoais em localStorage e sem service_role no aplicativo web.

Telas: login, painel, ordens com busca/status/paginação, abertura com classificação em cascata, detalhes/status/atribuição, mensagens, anexos privados, unidades, logística, rotas, veículos, motoristas, usuários/vínculos e auditoria. Administrador mantém cadastros e concilia vínculos; gestor consulta; solicitante abre e acompanha suas ordens; responsável acompanha atribuições e altera apenas status pelo procedimento autorizado.

O SQL usa prefixo `os_` para evitar ocupar nomes genéricos do SIGMA. Isso não autoriza aplicar sem inspeção: a existência prévia desses objetos/bucket deve ser conferida. Não há DROP, reset, alteração de tabelas legadas ou migration histórica. A migration é transacional e aplicada uma única vez pelo histórico de migrations; falha em colisões em vez de esconder incompatibilidades com IF NOT EXISTS em tabelas.

## Dados preservados

| Destino | Quantidade | Origem |
| --- | ---: | --- |
| os_units | 93 | UNIDADES do seed |
| os_catalogs | 534 | 306 classificações, 112 rotas, 65 veículos, 51 motoristas |
| os_orders | 5 | ABERTURA_OS |
| os_import_records | 1.576 | Seed integral + todas as linhas/células dos XLSX + CSV |

`npm run data:prepare` produz `migration-output/payload.json` e `report.json`, privados e ignorados no Git. O relatório contém hashes das fontes, contagens e avisos, sem imprimir registros pessoais no terminal. Os registros operacionais usam o seed que alimentava a aplicação; possíveis versões alternativas das planilhas/CSV ficam preservadas no arquivo de origem para conciliação, não duplicadas automaticamente nos cadastros ativos.

IDs UUID determinísticos preservam reexecução. O importador usa INSERT com conflito ignorado, nunca substitui registros existentes. Lotes não formam transação única: se houver falha, a mensagem identifica tabela/lote e uma nova execução retoma sem sobrescrever o que já entrou. Conferir o relatório e contagens após concluir. Não mudar ordenação/identificadores das fontes entre tentativas.

As 5 ordens ficam `A conferir`. O protótipo inventava status por posição no array; isso não é evidência histórica. Autoria e responsável ficam sem UUID até conciliação explícita com contas reais. Unidade só é vinculada quando existe exatamente uma correspondência por nome. Conteúdo original, inclusive mensagens e referências a anexos, permanece nos detalhes e no arquivo fiel; não se inventam autores ou datas para criar novas mensagens autenticadas.

Senhas e usuários demonstrativos não viram contas de produção. Dados criados exclusivamente no localStorage de cada navegador não estão nos arquivos do repositório: precisam ser exportados de cada navegador e conciliados antes de declarar migração completa. Referências de anexos não incluem necessariamente os arquivos binários; estes precisam ser recuperados da origem e enviados ao bucket privado. Nada foi apagado do legado.

A atribuição automática por área do protótipo apontava para a conta técnica demonstrativa. Ela não foi transferida para uma identidade real sem evidência; nesta versão a atribuição é explícita por administrador. Configurar automação por área exige definir os responsáveis reais e seus vínculos. As telas de seleção carregam até 1.000 opções e as mensagens/anexos mostram até 100 itens recentes; para volumes superiores, acrescentar busca/paginação específica antes de expansão.

## Modelo de autorização

| Perfil | Escopo | Escrita |
| --- | --- | --- |
| admin | Secretaria/rede, unidade nula | Cadastros, vínculos, ordens e status |
| gestor | Rede ou unidade explícita | Nenhuma |
| solicitante | Unidade explícita e ordens próprias | Abrir ordem, mensagens e anexos próprios |
| responsavel | Unidade explícita e atribuição explícita | Status, mensagens e anexos atribuídos |
| Sem vínculo / anônimo | Nenhum dado interno | Nenhuma |

Um usuário pode possuir vários vínculos. Professor, aluno e responsável familiar não são papéis de OS introduzidos implicitamente; qualquer integração futura precisa de regras próprias. Alteração de perfil é restrita a administrador no banco e servidor. Nenhuma exclusão física de ordens/cadastros é concedida a authenticated. Catálogos de apoio são compartilhados entre usuários com vínculo; ordens seguem isolamento por vínculo/autoria/atribuição.

Funções elevadas estão em `os_private`, com `search_path` vazio e objetos qualificados. São necessárias para consultar vínculos sem recursão de RLS, verificar acesso a relações e gravar auditoria. Não aceitam identidade de usuário como parâmetro; usam auth.uid(). As funções públicas `os_change_status`, `os_assign_order` e `os_edit_order` limitam cada operação aos campos e papéis necessários. A mudança de status também aplica a sequência permitida, exige motivo em encerramentos e reaberturas e grava `os_order_events`. EXECUTE público/anônimo foi revogado. RPC não substitui as demais políticas.

Audit registra autor, data, ação, entidade, ID, anterior e posterior de ordens/cadastros/vínculos/mensagens. Contém dados de negócio e é restrita a administradores; definir retenção antes de produção. Logs Supabase Auth devem ser utilizados para autenticação; não foi criado um coletor externo de dados pessoais.

## Sequência segura de ativação

1. Fazer backup do banco de destino e identificar o ambiente. Executar `supabase/preflight.sql` (somente leitura) e conferir o histórico remoto. Parar se já existirem objetos `os_*` incompatíveis ou o bucket `os-attachments`.
2. Aplicar, em ordem, os arquivos de `supabase/migrations/` pelo fluxo de migrations do projeto, primeiro em homologação. Não executar reset. Confirmar tabelas, grants, RLS, funções e bucket privado após cada migration.
3. Executar `npm run data:prepare`, conferir hashes/contagens/avisos. Configurar `.env.local` a partir de `.env.example`, sem versionar: URL, chave **publishable** e chave administrativa **somente local** para a importação. Nunca copiar chaves entre projetos.
4. Importar somente após revisão: `npm run data:import -- --apply ouixjkqcuqpfmhmmsdxg.supabase.co`. A chave administrativa não é usada pelo Next.js; não cadastrá-la na Vercel.
5. Criar uma conta real no Supabase Auth. O primeiro administrador precisa ser provisionado pelo operador do banco: inserir `os_profiles(id,name)` com o UUID dessa conta e `os_memberships(user_id,unit_id,role)` com unidade NULL e role `admin`. Nenhum UUID/e-mail foi presumido. Depois, usar a tela de usuários para os vínculos adicionais.
6. Conciliar as 5 ordens com usuários/unidades reais e status comprovado. Recuperar anexos e exportações locais de navegador. Conferir os registros de origem antes de marcar a migração completa.
7. No projeto Vercel existente, framework Next.js, raiz do repositório, build `npm run build`, Node 24. Configurar somente `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` para os ambientes desejados. Não alterar o projeto SIGMA.
8. Publicar primeiro em Preview e testar com contas de homologação: login/logout, todos os perfis, duas unidades, revogação de vínculo, criação/status/mensagem/anexo, URL assinada e auditoria. A página pública não deve servir `assets/seed-data.js`, planilhas ou payload de importação. Promover a produção somente após validar e revisar o impacto sobre o acesso existente.

O link GitHub Pages é do hospedador estático antigo: não executa SSR/Server Actions. O destino da aplicação nova é Vercel. Desativação do Pages ou remoção de conteúdo público antigo exige uma ação explícita posterior; os históricos não foram apagados.

## Validação e limitações

Verificação TypeScript, lint, build de produção, testes Node de inicialização legada/importação e execução real da migration/RLS em PostgreSQL WASM (PGlite). O teste cria substitutos mínimos de auth/storage para testar as políticas; isso **não** testa o serviço HTTP Supabase, upload real, seus grants preexistentes ou a configuração remota. Deve haver validação final em homologação Supabase.

Foi conferida a tela de login em navegador. Sem configuração, o sistema informa indisponibilidade e bloqueia páginas internas; não há dados demonstrativos ou fallback de autenticação no aplicativo novo. A produção informada ainda exibe o título do legado; não houve publicação.

Uploads limitados a 3 MB para caber no limite de requisições da Vercel, com MIME permitido, caminho vinculado à ordem e download assinado de 60 segundos. Se o upload falhar, metadados sem objeto são removidos mediante política restrita. Arquivos são servidos como download. Varredura antimalware, retenção, backups, MFA e testes de carga permanecem decisões de implantação; não foram desativados mecanismos existentes. Não foi validada capacidade de 1.000 acessos simultâneos.

## Fontes técnicas

- [Next.js: instalação](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase: cliente SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- Guias incluídos em `node_modules/next/dist/docs/`, compatíveis com a versão instalada.
