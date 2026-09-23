-- SOMENTE LEITURA: executar antes da migration no projeto de destino.
select current_database(), version();
select table_schema, table_name from information_schema.tables
where table_schema in ('public','storage','auth') order by table_schema,table_name;
select schemaname,tablename,policyname,roles,cmd from pg_policies
where schemaname in ('public','storage') order by tablename,policyname;
select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','os_private') order by n.nspname,p.proname;
select id,name,public from storage.buckets where id='os-attachments';
select to_regclass('supabase_migrations.schema_migrations') as migration_history;
-- Se migration_history existir, consultar suas versões antes de aplicar novos arquivos.
