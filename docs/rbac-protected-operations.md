# Operações protegidas por RBAC

O RBAC valida a capacidade do usuário. A RLS e as regras internas das RPCs
continuam validando a unidade, o vínculo, a autoria, o responsável, o estado da
OS e a versão esperada. Uma permissão nunca amplia o escopo de dados.

## Ordens de Serviço

| Permissão | Server Action | RPC ou escrita | Regra adicional no banco |
| --- | --- | --- | --- |
| `orders.create` | `createOrder` | `os_open_order` | vínculo solicitante/admin e unidade de origem |
| `orders.update` | `reconcileOrder`, `editOrderControlled`, edições legadas | `os_reconcile_order`, `os_edit_order_controlled`, `os_edit_order` | estado, versão, administrador e dados conciliáveis |
| `orders.triage` | `startTriage` | `os_start_triage` | estado atual, conciliação e papel legado autorizado |
| `orders.forward` | `forwardOrder` | `os_forward_order` | estado, versão, unidade executora ativa e administrador |
| `orders.assign` | `assignOrder`, atualização legada de vínculos | `os_assign_order` | vínculo responsável ativo e compatível com a executora |
| `orders.reassign` | `reassignOrder` | `os_reassign_order` | vínculo compatível, justificativa, estado e versão |
| `orders.attend` | `startService`, `addServiceEntry` | `os_start_service`, `os_add_service_entry` | responsável atribuído, estado e versão |
| `orders.wait_information` | `waitForInformation` | `os_wait_for_information` | responsável autorizado, motivo, estado e versão |
| `orders.resume` | `resumeService` | `os_resume_service` | `resume_status`, responsável, estado e versão |
| `orders.complete` | `completeOrder` | `os_complete_order` | responsável, registro/solução, estado e versão |
| `orders.cancel` | `cancelOrder` | `os_cancel_order` | justificativa, papel autorizado, estado e versão |
| `orders.reopen` | `reopenOrder` | `os_reopen_order` | estado terminal, justificativa e versão |
| `orders.view` | `addMessage`, `uploadAttachment` | RLS de mensagens; RPCs e RLS de anexos | visibilidade e escrita limitadas à OS acessível e não terminal |

As rotas `/ordens` e `/ordens/[id]` exigem `orders.view`. A rota
`/ordens/nova` exige `orders.create` e mantém a validação legada do vínculo.

## Profissionais e vínculos

| Permissão | Server Action/RPC | Regra adicional no banco |
| --- | --- | --- |
| `professionals.view` | página `/usuarios`, `os_professional_memberships` | permanece restrito a administrador legado |
| `professionals.create` | criação em `saveProfessionalMembership` | valida papel, unidade, e-mail e vínculo |
| `professionals.update` | atualização em `saveProfessionalMembership` | protege identidade vinculada e o próprio acesso |
| `professionals.delete` | `deactivateProfessionalMembership` / `os_deactivate_professional_membership` | desativa somente o vínculo, preserva referências e protege o último administrador |
| `professionals.manage` | papel admin, identidade e operações legadas de vínculo | protege concessão/revogação e o último administrador |

## Unidades, catálogos e auditoria

| Módulo | Permissões | Server Action/RPC | Escopo/regra adicional |
| --- | --- | --- | --- |
| Unidades | `units.view`, `units.create`, `units.update` | `saveUnit` / `os_save_unit` | leitura pela unidade vinculada; mutação mantém administração legada |
| Logística | `logistics.view`, `logistics.create`, `logistics.update` | `saveCatalog` / `os_save_catalog` | catálogo ativo e visível pelo escopo da OS |
| Rotas | `routes.view`, `routes.create`, `routes.update` | `saveCatalog` / `os_save_catalog` | catálogo ativo e visível pelo escopo da OS |
| Veículos | `vehicles.view`, `vehicles.create`, `vehicles.update` | `saveCatalog` / `os_save_catalog` | catálogo ativo e visível pelo escopo da OS |
| Motoristas | `drivers.view`, `drivers.create`, `drivers.update` | `saveCatalog` / `os_save_catalog` | catálogo ativo e visível pelo escopo da OS |
| Auditoria | `audit.view` | leitura de `os_audit` | permanece restrita a administrador legado |
| Perfis e permissões | `professionals.manage` | `saveAccessProfile`, `saveAccessProfilePermissions`, `deleteAccessProfile` | administrador legado, RPCs específicas, perfis de sistema e vínculos protegidos |

Desativação de unidades e catálogos utiliza `update`. Não existe operação de
exclusão desses módulos no fluxo atual.

## Camadas de proteção

1. A rota verifica a permissão no servidor para impedir acesso direto por URL.
2. A Server Action valida entrada, sessão e permissão antes da RPC.
3. O wrapper público da RPC verifica a permissão novamente.
4. A implementação interna preserva as regras legadas e transacionais.
5. A RLS limita quais registros e unidades podem ser lidos ou escritos.

As permissões são consultadas no PostgreSQL em cada operação. Não são mantidas
em JWT nem em cache de processo, portanto sua remoção vale na próxima chamada.
