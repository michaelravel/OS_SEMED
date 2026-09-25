-- Fundação aditiva de RBAC por módulo.
-- A coluna role continua sendo a autoridade durante a transição. O perfil de
-- acesso registra a equivalência e permite migrar RLS/RPCs gradualmente.
begin;

create table public.os_access_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  is_system boolean not null default false,
  legacy_role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_access_profiles_key_format check (
    key = lower(btrim(key)) and
    key ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  constraint os_access_profiles_name_length check (
    name = btrim(name) and length(name) between 1 and 120
  ),
  constraint os_access_profiles_description_length check (
    length(description) <= 1000
  ),
  constraint os_access_profiles_legacy_role_check check (
    legacy_role in ('admin','gestor','solicitante','responsavel')
  )
);

-- Um perfil de sistema representa cada papel legado. Perfis configuráveis
-- também informam um papel de compatibilidade enquanto o legado for utilizado.
create unique index os_access_profiles_system_legacy_role
  on public.os_access_profiles(legacy_role)
  where is_system;
create index os_access_profiles_active_name
  on public.os_access_profiles(active,name);

create table public.os_permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  module text not null,
  action text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint os_permissions_module_format check (
    module = lower(btrim(module)) and
    module ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  constraint os_permissions_action_format check (
    action = lower(btrim(action)) and
    action ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  constraint os_permissions_key_matches_parts check (
    key = module || '.' || action
  ),
  constraint os_permissions_description_length check (
    length(btrim(description)) between 1 and 500
  )
);

create index os_permissions_module_action
  on public.os_permissions(module,action);

create table public.os_access_profile_permissions (
  access_profile_id uuid not null,
  permission_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(access_profile_id,permission_id),
  constraint os_access_profile_permissions_profile_fk
    foreign key(access_profile_id)
    references public.os_access_profiles(id) on delete cascade,
  constraint os_access_profile_permissions_permission_fk
    foreign key(permission_id)
    references public.os_permissions(id) on delete cascade
);

create index os_access_profile_permissions_permission
  on public.os_access_profile_permissions(permission_id);

insert into public.os_access_profiles(
  id,key,name,description,active,is_system,legacy_role
) values
  ('a1000000-0000-4000-a000-000000000001','admin','Administrador',
   'Administração global preservada durante a transição para RBAC.',true,true,'admin'),
  ('a1000000-0000-4000-a000-000000000002','manager','Gestor',
   'Gestão e acompanhamento conforme o escopo da unidade.',true,true,'gestor'),
  ('a1000000-0000-4000-a000-000000000003','requester','Solicitante',
   'Abertura e acompanhamento das próprias Ordens de Serviço.',true,true,'solicitante'),
  ('a1000000-0000-4000-a000-000000000004','responsible','Responsável',
   'Atendimento das Ordens de Serviço formalmente atribuídas.',true,true,'responsavel');

insert into public.os_permissions(key,module,action,description) values
  ('dashboard.view','dashboard','view','Acessar a visão geral e seus indicadores autorizados.'),
  ('orders.view','orders','view','Listar e consultar Ordens de Serviço autorizadas pelo escopo.'),
  ('orders.create','orders','create','Abrir uma Ordem de Serviço.'),
  ('orders.update','orders','update','Editar campos controlados e conciliar uma Ordem de Serviço importada.'),
  ('orders.triage','orders','triage','Iniciar a triagem de uma Ordem de Serviço.'),
  ('orders.forward','orders','forward','Encaminhar uma Ordem de Serviço para a unidade executora.'),
  ('orders.assign','orders','assign','Atribuir o primeiro responsável por uma Ordem de Serviço.'),
  ('orders.reassign','orders','reassign','Substituir o responsável atribuído com justificativa.'),
  ('orders.attend','orders','attend','Iniciar o atendimento e registrar atendimentos formais.'),
  ('orders.wait_information','orders','wait_information','Colocar uma Ordem de Serviço em espera por informação.'),
  ('orders.resume','orders','resume','Retomar uma Ordem de Serviço em espera.'),
  ('orders.complete','orders','complete','Concluir uma Ordem de Serviço com solução.'),
  ('orders.cancel','orders','cancel','Cancelar uma Ordem de Serviço com justificativa.'),
  ('orders.reopen','orders','reopen','Reabrir formalmente uma Ordem de Serviço terminal.'),
  ('units.view','units','view','Listar e consultar unidades autorizadas pelo escopo.'),
  ('units.create','units','create','Cadastrar uma unidade.'),
  ('units.update','units','update','Alterar ou desativar uma unidade.'),
  ('logistics.view','logistics','view','Listar e consultar classificações logísticas.'),
  ('logistics.create','logistics','create','Cadastrar uma classificação logística.'),
  ('logistics.update','logistics','update','Alterar ou desativar uma classificação logística.'),
  ('routes.view','routes','view','Listar e consultar rotas.'),
  ('routes.create','routes','create','Cadastrar uma rota.'),
  ('routes.update','routes','update','Alterar ou desativar uma rota.'),
  ('vehicles.view','vehicles','view','Listar e consultar veículos.'),
  ('vehicles.create','vehicles','create','Cadastrar um veículo.'),
  ('vehicles.update','vehicles','update','Alterar ou desativar um veículo.'),
  ('drivers.view','drivers','view','Listar e consultar motoristas.'),
  ('drivers.create','drivers','create','Cadastrar um motorista.'),
  ('drivers.update','drivers','update','Alterar ou desativar um motorista.'),
  ('professionals.view','professionals','view','Listar e consultar profissionais e vínculos.'),
  ('professionals.create','professionals','create','Cadastrar profissionais e vínculos.'),
  ('professionals.update','professionals','update','Alterar dados de profissionais e vínculos.'),
  ('professionals.delete','professionals','delete','Desativar profissionais ou vínculos.'),
  ('professionals.manage','professionals','manage','Administrar identidades e papéis privilegiados.'),
  ('audit.view','audit','view','Visualizar a trilha de auditoria.');

-- O administrador preserva todas as capacidades atualmente existentes.
insert into public.os_access_profile_permissions(access_profile_id,permission_id)
select p.id,permission.id
from public.os_access_profiles p
cross join public.os_permissions permission
where p.key='admin';

-- Os demais perfis reproduzem apenas capacidades já existentes. RLS e regras
-- de estado continuam decidindo sobre quais registros a operação é permitida.
insert into public.os_access_profile_permissions(access_profile_id,permission_id)
select profile.id,permission.id
from public.os_access_profiles profile
join public.os_permissions permission on permission.key = any(case profile.key
  when 'manager' then array[
    'dashboard.view','orders.view','units.view','logistics.view','routes.view',
    'vehicles.view','drivers.view'
  ]::text[]
  when 'requester' then array[
    'dashboard.view','orders.view','orders.create','units.view',
    'logistics.view','routes.view',
    'vehicles.view','drivers.view'
  ]::text[]
  when 'responsible' then array[
    'dashboard.view','orders.view','orders.triage','orders.attend','orders.wait_information',
    'orders.resume','orders.complete','orders.cancel','orders.reopen',
    'units.view','logistics.view','routes.view',
    'vehicles.view','drivers.view'
  ]::text[]
  else array[]::text[]
end)
where profile.key in ('manager','requester','responsible');

alter table public.os_memberships
  add column access_profile_id uuid;

update public.os_memberships membership
set access_profile_id=profile.id
from public.os_access_profiles profile
where profile.is_system
  and profile.legacy_role=membership.role
  and membership.access_profile_id is null;

alter table public.os_memberships
  alter column access_profile_id set not null,
  add constraint os_memberships_access_profile_fk
    foreign key(access_profile_id)
    references public.os_access_profiles(id) on delete restrict;

create index os_memberships_access_profile
  on public.os_memberships(access_profile_id);

create function os_private.sync_membership_access_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  compatible_role text;
begin
  if tg_op='INSERT' then
    if new.access_profile_id is null then
      select p.id into new.access_profile_id
      from public.os_access_profiles p
      where p.is_system and p.active and p.legacy_role=new.role;
    else
      select p.legacy_role into compatible_role
      from public.os_access_profiles p
      where p.id=new.access_profile_id and p.active;
      if compatible_role is null then raise exception 'Perfil de acesso inválido ou inativo'; end if;
      new.role:=compatible_role;
    end if;
  elsif new.access_profile_id is distinct from old.access_profile_id then
    select p.legacy_role into compatible_role
    from public.os_access_profiles p
    where p.id=new.access_profile_id and p.active;
    if compatible_role is null then raise exception 'Perfil de acesso inválido ou inativo'; end if;
    new.role:=compatible_role;
  elsif new.role is distinct from old.role then
    select p.id into new.access_profile_id
    from public.os_access_profiles p
    where p.is_system and p.active and p.legacy_role=new.role;
  end if;

  if new.access_profile_id is null then
    raise exception 'Perfil de acesso obrigatório';
  end if;
  return new;
end;
$$;

create trigger memberships_sync_access_profile
  before insert or update of role,access_profile_id on public.os_memberships
  for each row execute function os_private.sync_membership_access_profile();

create function os_private.touch_access_profile_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at:=now();
  return new;
end;
$$;

create trigger access_profiles_updated_at
  before update on public.os_access_profiles
  for each row execute function os_private.touch_access_profile_updated_at();

alter table public.os_access_profiles enable row level security;
alter table public.os_permissions enable row level security;
alter table public.os_access_profile_permissions enable row level security;

-- Nesta etapa a configuração é somente estrutural. Administradores podem
-- inspecionar o catálogo, mas mutações diretas permanecem revogadas até que
-- operações administrativas específicas sejam implementadas.
create policy access_profiles_admin_read on public.os_access_profiles
  for select to authenticated using(os_private.is_admin());
create policy permissions_admin_read on public.os_permissions
  for select to authenticated using(os_private.is_admin());
create policy access_profile_permissions_admin_read
  on public.os_access_profile_permissions
  for select to authenticated using(os_private.is_admin());

revoke all on public.os_access_profiles,public.os_permissions,
  public.os_access_profile_permissions from public,anon,authenticated;
grant select on public.os_access_profiles,public.os_permissions,
  public.os_access_profile_permissions to authenticated;
grant all on public.os_access_profiles,public.os_permissions,
  public.os_access_profile_permissions to service_role;

revoke all on function os_private.sync_membership_access_profile()
  from public,anon,authenticated;
revoke all on function os_private.touch_access_profile_updated_at()
  from public,anon,authenticated;

commit;
