# OS SEMED — SIGMA

Sistema de ordens de serviço em **Next.js, TypeScript, Supabase e Vercel**, com a identidade visual do SIGMA.

## Desenvolvimento

Requer Node.js 24.

```sh
npm ci
npm run dev
```

Copie .env.example para .env.local e configure a chave publishable do projeto Supabase. A aplicação permanece bloqueada sem configuração; não usa contas demo como autenticação.

## Verificação

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

## Migração e implantação

Consulte [o guia completo](docs/migracao-next-supabase.md) antes de aplicar o SQL ou importar registros no destino.

Antes de qualquer migration em ambiente compartilhado, siga o [runbook de backup, recuperação e rollback](docs/runbook-backup-recuperacao.md).

- `npm run data:prepare` converte as fontes locais e gera um relatório privado.
- Migrations: aplicar, em ordem, os arquivos de `supabase/migrations/`.
- Inspeção remota, somente leitura: `supabase/preflight.sql`.
- A aplicação usa apenas URL e chave publishable; a chave administrativa é exclusiva do importador local.
- Não publique payloads, fontes ou chaves como arquivos estáticos.

A preparação local não significa que o banco remoto foi migrado ou que a Vercel foi publicada. Dados existentes apenas nos navegadores e arquivos de anexos ausentes precisam ser recuperados antes da conciliação final.

## Estrutura

- `src/app`: páginas, ações de servidor e download autorizado.
- `src/components`: interface SIGMA e formulários.
- `src/lib`: sessão, validação, domínio e tipos de banco.
- `supabase`: schema, RLS, funções e preflight.
- `scripts`: conversão/importação e testes legados.
- `tests`: importação e testes SQL/RLS em PostgreSQL WASM.

O protótipo original foi preservado na raiz como referência; não é servido pelo Next.js. A documentação anterior está em [legacy-readme.md](docs/legacy-readme.md). Não usar o login local demonstrativo para produção.
