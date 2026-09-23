# Reconhecimento e remediação inicial — 23/09/2026

## 1. Estado inicial e limites da conclusão

Checkout: branch `main`, HEAD `4b2b187`, inicialmente sem alterações locais. Inspecionados inventário completo de arquivos versionados, histórico recente, README, plano técnico, entrada HTML, regras JavaScript, extrator e estrutura do seed. Nenhuma auditoria anterior foi localizada. O plano técnico é uma proposta, não implementação. Não foram acessados serviços remotos, produção ou armazenamento de um usuário real.

Este checkout é DIRLOGISTICA, um protótipo estático; não é a implementação Next.js/TypeScript/Supabase descrita no pedido. Não é possível atestar a segurança de outro repositório ou implantação a partir destes arquivos. Não há package.json, lockfile, framework, tsconfig, lint, suíte anterior, configuração Vercel, APIs, server actions, middleware, SQL, migrations, RLS, funções PostgreSQL ou SECURITY DEFINER. Não foram encontrados indicadores pesquisados de service_role, chaves privadas ou chaves de serviço; isso não equivale a uma varredura completa de segredos no histórico e em binários.

### Mapa da arquitetura real

```text
ARQUITETURA: aplicação estática monolítica
↓ FRONTEND: index.html + styles.css + app.js (JavaScript nativo)
↓ BACKEND/APIs: ausentes
↓ AUTENTICAÇÃO: comparação local de senha em renderLogin
↓ AUTORIZAÇÃO: profileRules e funções locais de visibilidade/edição
↓ SUPABASE: ausente
↓ BANCO: objetos JavaScript persistidos integralmente em localStorage
↓ RLS: inexistente; filtros de tela não constituem RLS
↓ MIGRATIONS: inexistentes; normalizeState faz normalização local
↓ DEPLOY: arquivos estáticos; workflow GitHub Pages removido no HEAD
```

Dependências: index carrega seed antes de app; loadState importa cadastros e OS; usuários/perfis/unidades alimentam permissões e formulários; áreas de logística resolvem responsáveis por e-mail; OS referenciam unidades, responsáveis, veículos e rotas principalmente por nomes/strings; mensagens, histórico e anexos ficam embutidos na OS. Todas as telas e persistência compartilham `state`. O extrator PowerShell lê XLSX/CSV e sobrescreve seed; não foi executado para preservar dados.

Seed inventariado sem reproduzir dados pessoais: 5 OS, 306 classificações logísticas, 93 unidades, 112 rotas, 65 veículos e 51 motoristas. Há campos de nomes, endereços, placas, autoria, observações e anexos. A autenticidade e a autorização de divulgação desses registros não foram estabelecidas.

Baseline: Node v24.19.0. `node --check app.js` falhou em app.js:17 com SyntaxError; `node --check assets/seed-data.js` passou. TypeScript, lint, testes preexistentes e build: não disponíveis, não zero erros. Nenhum script npm foi inventado ou executado. O histórico confirma criação e posterior remoção do workflow de publicação; implantação atual não confirmada.

## 2. Quadro de acompanhamento e problemas confirmados

Severidade considera o uso educacional com dados reais solicitado; o README declara que este é um protótipo. As falhas latentes de execução abaixo tornam-se alcançáveis após corrigir a sintaxe.

| ID | Severidade | Área | Problema | Status |
| --- | --- | --- | --- | --- |
| SIG-001 | CRÍTICA | Autenticação/autorização | Confiança integral no navegador | BLOQUEADO |
| SIG-002 | CRÍTICA | Dados | Seed operacional distribuído antes do login | BLOQUEADO |
| SIG-003 | CRÍTICA | Disponibilidade/autenticação | Sintaxe impede toda inicialização | VALIDADO |
| SIG-004 | ALTA | Renderização | IDs sem escape e URLs sem validação de protocolo | PENDENTE |
| SIG-005 | ALTA | Autorização | saveUser sem guarda e saveOrder aceita campos indevidos | PENDENTE |
| SIG-006 | ALTA | Integridade | Vínculos por nomes, unidade automática e status inventado | PENDENTE |
| SIG-007 | MÉDIA | Persistência | Anexos descartados silenciosamente e storage sem tratamento | PENDENTE |
| SIG-008 | MÉDIA | Login demonstrativo | Senha administrativa diverge da tela e README | PENDENTE |

### [CRÍTICA] SIG-001 — Confiança integral no navegador

Arquivo/linha: app.js:14–18, 79–87, 164–199, 233–235, 275–359, 386–399, 1308.

Problema: senhas legíveis, sessão, perfis, dados e regras estão no cliente. Evidência: `localStorage.setItem(STORAGE_KEY, JSON.stringify(next))`, comparação local de senha e permissões derivadas de `state.session.role`. Impacto: quem controla o navegador pode ler dados e modificar identidade/permissões; não existe fronteira de segurança entre unidades. Causa raiz: arquitetura demonstrativa sem servidor confiável. Correção proposta: autenticação no servidor, vínculos persistidos com IDs, autorização por operação/unidade e políticas de banco verificadas. Alteração realizada: nenhuma; hashing ou novas guardas somente no navegador não resolveriam a causa. Validação: leitura dos fluxos e persistência, sem adulterar sessão real. Resultado: BLOQUEADO pela ausência de backend e definição do sistema alvo. Risco residual: integral para dados reais.

### [CRÍTICA] SIG-002 — Distribuição de dados antes da autenticação

Arquivo/linha: index.html:36–37; assets/seed-data.js:1; source-data/.

Problema/evidência: o HTML carrega todas as tabelas em um script público, independentemente do login; planilhas também estão versionadas. Impacto: se publicado com dados reais, os registros podem ser obtidos sem passar pelos filtros da interface. Não se afirma que existe implantação pública. Causa raiz: dados operacionais empacotados como assets. Correção proposta: dados sintéticos no demonstrativo e dados reais em armazenamento protegido; verificar conteúdo/histórico e publicação antes de qualquer retirada. Alteração realizada: nenhuma; não apagados registros ou histórico. Validação: inventário de tabelas/campos e ordem dos scripts. Resultado: BLOQUEADO para decidir a destinação dos dados e implantação. Risco residual: cópias já distribuídas não seriam revogadas por uma mudança no frontend.

### [CRÍTICA] SIG-003 — Aplicação inteira não inicializa

Arquivo/linha: app.js:17.

Problema/evidência: literal do e-mail demonstrativo sem aspa de fechamento; Node aponta SyntaxError. Impacto: nenhum código do arquivo executa, incluindo renderização e autenticação. Classificação crítica por quebra generalizada da inicialização/login, não por invasão. Causa raiz: edição inválida do literal sem verificação sintática. Correção proposta/realizada: acrescentada somente a aspa faltante, preservando o valor previsto. Validação: falha reproduzida no HEAD original via vm.Script; verificações sintáticas após correção e teste isolado de inicialização com armazenamento em memória. Resultado: CORRIGIDO, VALIDADO no escopo testado. Risco residual: restaurar execução não corrige SIG-001/002 nem demonstra funcionamento integral no navegador.

### [ALTA] SIG-004 — Conteúdo dinâmico em HTML e links

Arquivo/linha: app.js:538, 596–597, 622, 638, 726, 969, 1073–1075.

Problema/evidência: IDs interpolados em atributos e título sem escape; links escapam HTML mas não restringem esquemas de URL. Impacto: conteúdo especialmente construído pode gerar marcação ou links executáveis. Causa raiz: codificação contextual incompleta. Correção proposta: escapar cada atributo/texto e validar URLs por finalidade, com casos adversariais. Alteração realizada: nenhuma nesta onda crítica. Validação: inspeção dos templates; exploração em navegador não realizada. Resultado: PENDENTE. Risco residual: superfície latente após restaurar parsing.

### [ALTA] SIG-005 — Guardas incompletas nas mutações

Arquivo/linha: app.js:871–918, 1285–1330.

Problema/evidência: saveUser não valida isAdmin; saveOrder autoriza responsável mas monta payload com todos os campos do formulário. Campos desabilitados não são enviados pelo formulário normal, enquanto chamada manipulada pode fornecê-los. Impacto: fluxo de status pode falhar na validação de área e chamada manipulada pode alterar outros atributos. Causa raiz: restrições de tela substituem separação de comandos autorizados. Correção proposta: guarda por operação e payload específico para mudança de status, com testes por perfil; autorização final deve existir no backend. Alteração realizada: nenhuma. Validação: fluxo form → FormData → payload examinado. Resultado: PENDENTE. Risco residual: qualquer correção local ainda depende de SIG-001.

### [ALTA] SIG-006 — Integridade e vínculos inferidos

Arquivo/linha: app.js:119–139, 202–206, 222–230, 326–344.

Problema/evidência: status importado é `statuses[index % 5]`; unidade ausente recebe unidade padrão; responsável é comparado por nome ou e-mail; perfil desconhecido vira Solicitante. Impacto: status sem base na origem, ambiguidade de homônimos e atribuição de unidade/permissão sem vínculo comprovado. Causa raiz: modelo de demonstração baseado em strings e defaults de domínio. Correção proposta: mapear origem/status explicitamente, vínculos com IDs e negação para perfis/vínculos inválidos; planejar migração preservando registros. Alteração realizada: nenhuma para evitar redefinir vínculos existentes. Validação: inspeção dos mapeamentos. Resultado: PENDENTE. Risco residual: requer decisões de domínio.

### [MÉDIA] SIG-007 — Persistência e anexos

Arquivo/linha: app.js:80–81, 233–235, 748–767.

Problema/evidência: arquivo maior que 900000 bytes mantém metadados mas recebe dataUrl vazia; erro de leitura resolve string vazia; parse e gravação local sem tratamento. Impacto: aparente upload sem conteúdo e interrupção por quota ou JSON inválido. Causa raiz: falha silenciosa e storage limitado. Correção proposta: rejeição explícita antes da alteração, tratamento sem apagar estado e storage apropriado. Alteração realizada: nenhuma. Validação: inspeção. Resultado: PENDENTE. Risco residual: histórico/auditoria local também é editável, sem anterior/posterior confiável; escala concorrente não foi testada e não é atendida por armazenamento isolado por navegador.

### [MÉDIA] SIG-008 — Credencial demonstrativa inconsistente

Arquivo/linha: app.js:15; index.html:28; README.md:18.

Problema/evidência: senha do administrador no código difere da preenchida e documentada. Impacto: login padrão rejeitado em armazenamento novo. Causa raiz: edição não sincronizada; estado persistido ainda pode conter outro valor. Correção proposta: definir uma convenção apenas para demonstração, sem reescrever senhas salvas. Alteração realizada: nenhuma, para não modificar credenciais além do reparo sintático. Validação: comparação de arquivos. Resultado: PENDENTE. Risco residual: todas as credenciais demonstrativas são públicas por definição.

## 3. Correções realizadas

Somente SIG-003 e teste associado. Sem refatoração, novas dependências, ajustes cosméticos ou alteração dos dados. A restauração da execução não habilita uso seguro em produção.

## 4. Arquivos modificados e diff

- app.js: uma aspa adicionada na linha 17.
- scripts/startup.test.cjs: novo teste executável pelo runner nativo do Node, sem dependências.
- docs/auditoria-2026-09-23.md: novo baseline, evidências e fila de remediação.

Diff funcional (fragmento):

```diff
-email: "tecnico@dirlogistica.local, password:
+email: "tecnico@dirlogistica.local", password:
```

## 5. Migrations criadas ou modificadas

Nenhuma. Não existe linha do tempo SQL neste checkout. Histórico remoto, grants, constraints, FKs, índices, triggers, views e divergência local/remota não podem ser avaliados sem o projeto correspondente. Não presumir que os incidentes antigos de perfis/roles ainda existem.

## 6. Alterações de RLS

Nenhuma; não há banco/RLS implementado neste código. Nenhuma política foi desabilitada ou criada.

## 7. Alterações de autenticação/autorização

Somente parsing restaurado. Nenhuma credencial, perfil, sessão ou regra de autorização foi alterada. Cenários: administrador e gestor têm visibilidade global por regra local; solicitante filtra por autoria; responsável por nome/e-mail. Professor, aluno, responsável familiar e gestor escolar por vínculo não estão modelados. Anônimo não vê a tela interna, mas recebe o seed; ausência de vínculo não é uma barreira de acesso aos dados distribuídos. Portanto os cenários de isolamento solicitados não passam como controles de segurança.

## 8. Testes executados

- Antes: `node --check app.js` falhou; seed passou.
- Original confirmado novamente via `git show HEAD:app.js` e vm.Script, sem alterar checkout: SyntaxError reproduzido.
- Depois: `node --test scripts/startup.test.cjs`: 2 passaram, 0 falharam.
- `node --check app.js` e `node --check assets/seed-data.js`: passaram.
- `git diff --check`: passou; Git avisa conversão LF/CRLF conforme ambiente.
- Diff de app.js revisado: somente uma linha funcional alterada.

Teste usa DOM mínimo e storage em memória; não é E2E, não valida layout, upload, todos os logins, concorrência ou segurança de produção. Nenhum teste de banco é possível neste checkout.

## 9. Resultado do build

Não aplicável: aplicação estática sem processo de build definido. Verificação sintática bem-sucedida não deve ser apresentada como build Next.js aprovado.

## 10. Pendências e plano em ondas

Onda 0 concluída para os artefatos locais, com limites acima. Onda 1 parcial: SIG-003 corrigido; SIG-001/002 impedem declaração de segurança. Primeiro confirmar se este é o repositório pretendido. Se for apenas demonstração, definir dados sintéticos; se for o produto, preparar monólito modular com fronteira de servidor e modelo de vínculos, sem implementar silenciosamente nova arquitetura.

Ordem da fila: credenciais/dados (SIG-001/002), autenticação e autorização (SIG-001/005/006), RLS e funções privilegiadas no projeto efetivo, migrations e integridade (SIG-006), APIs e validação/renderização (SIG-004/005), tipagem quando aplicável, erros (SIG-007), ampliação de testes, performance, acessibilidade, observabilidade e dívida técnica. SIG-008 somente após conter riscos críticos. Não criar índices ou migrations sem consultas/schema reais.

## 11. Riscos residuais e decisão necessária

Problema: stack descrita ausente e dados distribuídos com autenticação simulada. Risco: substituir arquitetura ou dados sem conhecer destino pode quebrar compatibilidade e vínculos. Opções: (A) auditar o checkout correto do sistema Supabase; (B) manter este projeto como demonstrativo com dados sintéticos; (C) aprovar desenho e implementação de evolução para produção. Recomendação: confirmar A antes de assumir C. Não houve deploy, commit, alteração remota ou exclusão de dados. Nenhum problema crítico foi ocultado pelo sucesso dos testes.

## 12. Próxima onda recomendada

Continuar Onda 1 no repositório confirmado: definir a fronteira de autenticação/autorização e proteção dos dados. As ondas de banco, backend e TypeScript dependem da existência ou definição dessa implementação. Não é possível declarar compreensão ou segurança de um sistema de produção não presente neste checkout.
