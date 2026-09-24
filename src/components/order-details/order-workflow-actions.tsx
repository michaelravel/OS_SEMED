import {
  assignOrder,
  cancelOrder,
  completeOrder,
  forwardOrder,
  reassignOrder,
  reconcileOrder,
  reopenOrder,
  resumeService,
  startService,
  startTriage,
  waitForInformation,
} from "@/app/actions";
import {
  orderWaitReasons,
  workflowActionNames,
  workflowLimits,
} from "@/lib/domain";
import type {
  AvailableWorkflowAction,
  NamedOption,
  OrderCatalog,
  ResponsibleMembershipOption,
} from "./types";

type Props = {
  id: string;
  version: number;
  actions: AvailableWorkflowAction[];
  units: NamedOption[];
  requesters: NamedOption[];
  responsibleMemberships: ResponsibleMembershipOption[];
  catalogs: OrderCatalog[];
};

export function OrderWorkflowActions({
  id,
  version,
  actions,
  units,
  requesters,
  responsibleMemberships,
  catalogs,
}: Props) {
  const available = new Set(actions.map(({ operation }) => operation));
  const versionFields = (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
    </>
  );

  if (!available.size) return null;

  return (
    <section className="card workflow-actions-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">AÇÕES</p>
          <h2>Operações disponíveis</h2>
          <p className="muted">
            As opções abaixo respeitam seu vínculo, a atribuição e o estado atual
            da ordem.
          </p>
        </div>
      </div>
      <div className="workflow-actions-grid">
        {available.has(workflowActionNames.reconcile) && (
          <form action={reconcileOrder} className="form-grid span-2">
            {versionFields}
            <label>
              Unidade solicitante
              <select name="unit_id" required defaultValue="">
                <option value="">Selecione</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Solicitante
              <select name="opened_by" required defaultValue="">
                <option value="">Selecione</option>
                {requesters.map((requester) => (
                  <option key={requester.id} value={requester.id}>
                    {requester.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Categoria
              <select name="category_id" required defaultValue="">
                <option value="">Selecione</option>
                {catalogs
                  .filter((catalog) => catalog.kind === "logistics")
                  .map((catalog) => (
                    <option key={catalog.id} value={catalog.id}>
                      {catalog.name}
                    </option>
                  ))}
              </select>
            </label>
            <div>
              <button>Conciliar e iniciar triagem</button>
            </div>
          </form>
        )}

        {available.has(workflowActionNames.triage) && (
          <form action={startTriage}>
            {versionFields}
            <button>Iniciar triagem</button>
          </form>
        )}

        {available.has(workflowActionNames.forward) && (
          <form action={forwardOrder}>
            {versionFields}
            <label>
              Unidade executora
              <select name="destination_unit_id" required defaultValue="">
                <option value="">Selecione</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <button>Encaminhar ordem</button>
          </form>
        )}

        {available.has(workflowActionNames.assign) && (
          <form action={assignOrder}>
            {versionFields}
            <label>
              Responsável
              <select
                name="responsible_membership_id"
                required
                defaultValue=""
              >
                <option value="">Selecione</option>
                {responsibleMemberships.map((membership) => (
                  <option key={membership.id} value={membership.id}>
                    {membership.name}
                  </option>
                ))}
              </select>
            </label>
            <button>Atribuir responsável</button>
          </form>
        )}

        {available.has(workflowActionNames.reassign) && (
          <form action={reassignOrder}>
            {versionFields}
            <label>
              Novo responsável
              <select
                name="responsible_membership_id"
                required
                defaultValue=""
              >
                <option value="">Selecione</option>
                {responsibleMemberships.map((membership) => (
                  <option key={membership.id} value={membership.id}>
                    {membership.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Justificativa
              <textarea
                name="justification"
                required
                minLength={workflowLimits.justificationMin}
                maxLength={workflowLimits.justificationMax}
              />
            </label>
            <button>Reatribuir responsável</button>
          </form>
        )}

        {available.has(workflowActionNames.startService) && (
          <form action={startService}>
            {versionFields}
            <button>Iniciar atendimento</button>
          </form>
        )}

        {available.has(workflowActionNames.waitInformation) && (
          <form action={waitForInformation}>
            {versionFields}
            <label>
              Motivo da espera
              <select name="waitingReason" required defaultValue="">
                <option value="">Selecione</option>
                {orderWaitReasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Detalhes
              <textarea
                name="justification"
                required
                minLength={workflowLimits.justificationMin}
                maxLength={workflowLimits.justificationMax}
              />
            </label>
            <button>Aguardar informação</button>
          </form>
        )}

        {available.has(workflowActionNames.resume) && (
          <form action={resumeService}>
            {versionFields}
            <button>Retomar fluxo</button>
          </form>
        )}

        {available.has(workflowActionNames.complete) && (
          <form action={completeOrder}>
            {versionFields}
            <label>
              Solução aplicada
              <textarea
                name="solution"
                required
                minLength={workflowLimits.solutionMin}
                maxLength={workflowLimits.solutionMax}
                rows={4}
              />
            </label>
            <button>Concluir ordem</button>
          </form>
        )}

        {available.has(workflowActionNames.cancel) && (
          <form action={cancelOrder}>
            {versionFields}
            <label>
              Justificativa do cancelamento
              <textarea
                name="justification"
                required
                minLength={workflowLimits.justificationMin}
                maxLength={workflowLimits.justificationMax}
              />
            </label>
            <button>Cancelar ordem</button>
          </form>
        )}

        {available.has(workflowActionNames.reopen) && (
          <form action={reopenOrder}>
            {versionFields}
            <label>
              Justificativa da reabertura
              <textarea
                name="justification"
                required
                minLength={workflowLimits.justificationMin}
                maxLength={workflowLimits.justificationMax}
              />
            </label>
            <button>Reabrir ordem</button>
          </form>
        )}
      </div>
    </section>
  );
}
