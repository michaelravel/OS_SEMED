# Integração final de Perfis e Permissões

## Perfis iniciais

| Perfil | Chave | Compatibilidade | Capacidades iniciais |
| --- | --- | --- | --- |
| Administrador | `admin` | `admin` | Catálogo completo |
| Gestor | `manager` | `gestor` | Consulta do painel, OS, unidades e catálogos |
| Responsável | `responsible` | `responsavel` | Consulta e atendimento das OS autorizadas |
| Solicitante | `requester` | `solicitante` | Consulta e abertura das próprias OS |
| Consulta | `viewer` | `solicitante` | Consulta em seu escopo, sem alterações |

Permissão define a capacidade. O vínculo, a unidade, o papel compatível, as
regras da RPC e a RLS continuam definindo o escopo dos registros.

## Catálogo completo

| Módulo | Permissão | Operação protegida |
| --- | --- | --- |
| Painel | `dashboard.view` | Visualizar indicadores autorizados |
| Ordens | `orders.view` | Listar e consultar OS |
| Ordens | `orders.create` | Abrir OS |
| Ordens | `orders.update` | Conciliar e editar campos controlados |
| Ordens | `orders.triage` | Iniciar triagem |
| Ordens | `orders.forward` | Encaminhar |
| Ordens | `orders.assign` | Atribuir responsável |
| Ordens | `orders.reassign` | Reatribuir responsável |
| Ordens | `orders.attend` | Iniciar e registrar atendimento |
| Ordens | `orders.wait_information` | Aguardar informação |
| Ordens | `orders.resume` | Retomar fluxo |
| Ordens | `orders.complete` | Concluir |
| Ordens | `orders.cancel` | Cancelar |
| Ordens | `orders.reopen` | Reabrir |
| Unidades | `units.view` | Consultar unidades no escopo |
| Unidades | `units.create` | Cadastrar unidade |
| Unidades | `units.update` | Alterar ou desativar unidade |
| Logística | `logistics.view` | Consultar classificações logísticas |
| Logística | `logistics.create` | Cadastrar classificação logística |
| Logística | `logistics.update` | Alterar ou desativar classificação logística |
| Rotas | `routes.view` | Consultar rotas |
| Rotas | `routes.create` | Cadastrar rota |
| Rotas | `routes.update` | Alterar ou desativar rota |
| Veículos | `vehicles.view` | Consultar veículos |
| Veículos | `vehicles.create` | Cadastrar veículo |
| Veículos | `vehicles.update` | Alterar ou desativar veículo |
| Motoristas | `drivers.view` | Consultar motoristas |
| Motoristas | `drivers.create` | Cadastrar motorista |
| Motoristas | `drivers.update` | Alterar ou desativar motorista |
| Profissionais | `professionals.view` | Consultar profissionais e vínculos |
| Profissionais | `professionals.create` | Cadastrar profissional e vínculo |
| Profissionais | `professionals.update` | Alterar profissional e vínculo |
| Profissionais | `professionals.delete` | Desativar vínculo com preservação histórica |
| Profissionais | `professionals.manage` | Administrar identidades, administradores e perfis |
| Auditoria | `audit.view` | Consultar a trilha de auditoria |

Não existe módulo de relatórios no projeto atual; nenhuma permissão fictícia foi
criada para ele.

## Matriz inicial

| Perfil | Permissões concedidas |
| --- | --- |
| Administrador | Todas as permissões do catálogo |
| Gestor | `dashboard.view`, `orders.view`, `units.view`, `logistics.view`, `routes.view`, `vehicles.view`, `drivers.view` |
| Responsável | `dashboard.view`, `orders.view`, `orders.triage`, `orders.attend`, `orders.wait_information`, `orders.resume`, `orders.complete`, `orders.cancel`, `orders.reopen`, `units.view`, `logistics.view`, `routes.view`, `vehicles.view`, `drivers.view` |
| Solicitante | `dashboard.view`, `orders.view`, `orders.create`, `units.view`, `logistics.view`, `routes.view`, `vehicles.view`, `drivers.view` |
| Consulta | `dashboard.view`, `orders.view`, `units.view`, `logistics.view`, `routes.view`, `vehicles.view`, `drivers.view` |

## Camadas de proteção

- O menu usa o catálogo central para ocultar módulos sem permissão.
- Cada página privada exige a permissão novamente no servidor.
- Server Actions validam dados e permissão antes de chamar a RPC.
- RPCs críticas repetem RBAC e as regras legadas de papel e estado.
- RLS limita registros por vínculo, unidade, solicitante e responsável.
- Mudanças na matriz consultam o banco a cada operação; não há cache de processo
  nem dependência de permissão gravada no JWT.
- A troca da matriz registra ator, perfil, data, conjunto anterior, conjunto
  final, permissões adicionadas e permissões removidas.

## Migrations pendentes

1. `202609250004_rbac_profiles_permissions.sql`
2. `202609250005_rbac_authorization.sql`
3. `202609250006_rbac_profile_administration.sql`
4. `202609250007_rbac_ui_integration.sql`

Devem ser aplicadas nessa ordem. Nenhuma delas foi executada remotamente.

## Homologação

1. Criar backup verificável do banco e dos anexos conforme o runbook.
2. Restaurar uma cópia recente de Production em um projeto de homologação.
3. Aplicar as migrations pendentes na ordem indicada.
4. Executar a suíte automatizada contra o schema de homologação.
5. Vincular contas de teste aos cinco perfis, em pelo menos duas unidades.
6. Conferir menu, URLs diretas, CRUD administrativo e todas as operações de OS.
7. Remover uma permissão durante uma sessão ativa e confirmar efeito na próxima
   navegação/operação.
8. Tentar desativar o último administrador e confirmar a rejeição.
9. Conferir em `os_audit` o ator, perfil e diferenças de permissões.
10. Validar logs, anexos, logout e restauração do backup antes de Production.
