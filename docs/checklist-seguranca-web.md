# Checklist operacional de segurança web

Este checklist separa os controles implementados no OS_SEMED daqueles que
dependem da configuração do Supabase ou da Vercel. Ele não confirma o estado
atual dos painéis dos provedores.

## Aplicação

- [x] CSP com nonce único por requisição e origens do Supabase calculadas a
  partir da variável pública configurada.
- [x] Rotas privadas protegidas antecipadamente no Proxy e novamente nos
  componentes, ações do servidor e RLS.
- [x] Logout limitado à sessão atual, com aviso quando o Supabase não confirma
  a operação.
- [x] Respostas dinâmicas da aplicação marcadas como privadas e sem cache.
- [x] Headers contra MIME sniffing, framing, vazamento de referência e acesso a
  recursos do navegador não utilizados.

## Supabase Auth — VALIDAR NO PROVEDOR

- [ ] **MFA dos usuários do OS_SEMED:** confirmar os fatores disponíveis em
  Authentication > Multi-Factor e definir se o uso será obrigatório para todos
  ou, no mínimo, para administradores. Ativar o recurso no painel não basta: a
  aplicação ainda precisará dos fluxos de cadastro, desafio, recuperação e
  enforcement de `aal2` no servidor e no RLS.
- [ ] **MFA da equipe que administra o projeto:** exigir MFA para proprietários
  e colaboradores da organização, se o plano contratado oferecer essa opção.
- [ ] **Recuperação de senha:** validar Site URL, Redirect URLs, template de
  recuperação, expiração do link e SMTP. A aplicação ainda não oferece a tela
  e o callback de recuperação; não habilitar um fluxo sem testar o percurso
  completo em Preview.
- [ ] **Rate limits:** revisar Authentication > Rate Limits para login,
  recuperação, verificação, refresh e MFA conforme o uso real. Registrar os
  valores aprovados e monitorar respostas HTTP 429 antes de reduzi-los.
- [ ] **Proteção contra abuso:** avaliar CAPTCHA para login e recuperação em
  Authentication > Bot and Abuse Protection. A ativação também exige integrar
  o token do provedor ao formulário; não ligar apenas no painel.
- [ ] **Política de senha:** validar comprimento mínimo, requisitos de força e
  proteção contra senhas vazadas, observando disponibilidade no plano.
- [ ] **Sessões:** revisar duração do JWT, rotação de refresh token, tempo máximo
  da sessão, inatividade e limite de sessões simultâneas. Confirmar impacto nos
  usuários antes de alterar.
- [ ] **Cadastro público:** confirmar que criação anônima de contas e login
  anônimo estão desativados quando os usuários forem provisionados somente pela
  Secretaria.
- [ ] **Logs de autenticação:** definir responsável e rotina para revisar
  falhas repetidas, bloqueios e eventos administrativos, conforme retenção e
  disponibilidade do plano.

## Vercel — VALIDAR NO PROVEDOR

- [x] O domínio de produção `os-semed.vercel.app` foi verificado em 24/09/2026
  e respondeu com `Strict-Transport-Security: max-age=63072000;
  includeSubDomains; preload`. A Vercel documenta HSTS automático; por isso a
  aplicação não duplica o header quando `VERCEL` está presente.
- [ ] Repetir a verificação para cada domínio personalizado que venha a ser
  associado ao projeto.
- [ ] Confirmar que todos os domínios redirecionam HTTP para HTTPS e que nenhum
  proxy externo remove ou reduz o HSTS.
- [ ] Conferir separadamente Preview e Production após cada alteração de
  domínio, CDN ou proxy.

## Validação após deploy

- [ ] Abrir login, painel, uma OS e um anexo com o console do navegador aberto;
  não deve haver bloqueios CSP para recursos legítimos.
- [ ] Acessar painel, OS e anexo sem sessão; todas devem encaminhar ao login.
- [ ] Encerrar a sessão e confirmar que voltar pelo histórico não revela dados.
- [ ] Conferir os headers de resposta do HTML em Production e Preview.
- [ ] Registrar qualquer origem adicional antes de ampliar a CSP; não usar `*`
  nem adicionar `unsafe-inline` a scripts.

## Referências oficiais

- Supabase MFA: https://supabase.com/docs/guides/auth/auth-mfa
- Supabase rate limits: https://supabase.com/docs/guides/auth/rate-limits
- Supabase CAPTCHA: https://supabase.com/docs/guides/auth/auth-captcha
- Recuperação por senha e URLs permitidas:
  https://supabase.com/docs/guides/auth/passwords e
  https://supabase.com/docs/guides/auth/redirect-urls
- Segurança de senhas: https://supabase.com/docs/guides/auth/password-security
- Sessões: https://supabase.com/docs/guides/auth/sessions
- Configuração geral do Supabase Auth:
  https://supabase.com/docs/guides/auth/general-configuration
- Headers de resposta da Vercel:
  https://vercel.com/docs/headers/response-headers
