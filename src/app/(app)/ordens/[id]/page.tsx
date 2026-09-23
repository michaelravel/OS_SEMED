import { notFound } from "next/navigation";
import { z } from "zod";
import { session } from "@/lib/session";
import { statuses, type Order } from "@/lib/domain";
import { Heading, Badge, Notice, date } from "@/components/ui";
import {
  changeStatus,
  assignOrder,
  addMessage,
  uploadAttachment,
  editOrderDetails,
} from "@/app/actions";
import Link from "next/link";
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, admin, user, memberships } = await session();
  const { data, error } = await db
    .from("os_orders")
    .select(
      "id,legacy_id,title,status,unit_id,opened_by,responsible_id,category_id,details,created_at,opened_at,active",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar ordem");
  if (!data) notFound();
  const o = data as Order;
  const [messages, attachments, units, profiles] = await Promise.all([
    db
      .from("os_messages")
      .select("id,body,created_at,author_id")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("os_attachments")
      .select("id,name,size_bytes")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    db.from("os_units").select("id,name").order("name").limit(1000),
    admin
      ? db.from("os_profiles").select("id,name").order("name").limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if ([messages, attachments, units, profiles].some((r) => r.error))
    throw new Error("Falha ao consultar detalhes");
  const assigned =
    memberships.some(
      (m) => m.role === "responsavel" && m.unit_id === o.unit_id,
    ) && o.responsible_id === user.id;
  const canPost =
    admin ||
    assigned ||
    (o.opened_by === user.id &&
      memberships.some(
        (m) => m.role === "solicitante" && m.unit_id === o.unit_id,
      ));
  const unit = units.data?.find((u) => u.id === o.unit_id);
  return (
    <>
      <Heading
        title={o.title}
        description={`Ordem ${o.legacy_id ?? o.id.slice(0, 8)} · ${unit?.name ?? "Unidade aguardando conciliação"}`}
      />
      <Notice error={(await searchParams).erro} />
      <div className="detail-grid">
        <section className="card">
          <div className="section-head">
            <h2>Resumo da solicitação</h2>
            <Badge status={o.status} />
          </div>
          <dl className="details">
            <dt>Abertura</dt>
            <dd>{date(o.opened_at)}</dd>
            {Object.entries(o.details).map(([k, v]) => (
              <div key={k}>
                <dt>
                  {(
                    {
                      observation: "Observações",
                      occurred_at: "Data do ocorrido",
                      has_material: "Material",
                      police_report: "B.O. / REDS",
                      driver: "Motorista",
                      vehicle: "Veículo",
                      route: "Rota",
                    } as Record<string, string>
                  )[k] ?? k}
                </dt>
                <dd>{String(v) || "Não informado"}</dd>
              </div>
            ))}
          </dl>
          {(admin || assigned) && (
            <form action={changeStatus} className="filters">
              <input type="hidden" name="id" value={id} />
              <label>
                Situação
                <select name="status" defaultValue={o.status}>
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <button>Atualizar status</button>
            </form>
          )}
        </section>
        <section className="card">
          <h2>Anexos</h2>
          <p className="muted">Arquivos privados · até 3 MB por arquivo.</p>
          {attachments.data?.map((a) => (
            <p key={a.id}>
              <Link href={`/anexos/${a.id}`}>{a.name}</Link>{" "}
              <small>({Math.ceil(a.size_bytes / 1024)} KB)</small>
            </p>
          ))}
          {!attachments.data?.length && (
            <p className="empty">Nenhum anexo enviado.</p>
          )}
          {canPost && (
            <form action={uploadAttachment}>
              <input type="hidden" name="id" value={id} />
              <label>
                Adicionar arquivo
                <input
                  type="file"
                  name="file"
                  required
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.xlsx,.docx"
                />
              </label>
              <button>Enviar anexo</button>
            </form>
          )}
        </section>
      </div>
      {admin && (
        <section className="card">
          <h2>Vínculos da ordem</h2>
          <p className="muted">
            O responsável e o solicitante devem possuir vínculo ativo com a
            unidade selecionada.
          </p>
          <form action={assignOrder} className="form-grid">
            <input type="hidden" name="id" value={id} />
            <label>
              Unidade
              <select name="unit_id" defaultValue={o.unit_id ?? ""} required>
                <option value="">Selecione</option>
                {units.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            {[
              ["responsible_id", "Responsável", o.responsible_id],
              ["opened_by", "Solicitante", o.opened_by],
            ].map(([key, label, value]) => (
              <label key={key}>
                {label}
                <select name={key ?? ""} defaultValue={value ?? ""}>
                  <option value="">Não vinculado</option>
                  {profiles.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div>
              <button>Salvar vínculos</button>
            </div>
          </form>
        </section>
      )}
      {admin && (
        <section className="card">
          <h2>Editar solicitação</h2>
          <form action={editOrderDetails} className="form-grid">
            <input type="hidden" name="id" value={id} />
            <label className="span-2">
              Título
              <input
                name="title"
                required
                minLength={3}
                maxLength={500}
                defaultValue={o.title}
              />
            </label>
            <label>
              Possui material?
              <select
                name="has_material"
                defaultValue={o.details.has_material ?? "Não informado"}
              >
                <option>Não informado</option>
                <option>Sim</option>
                <option>Não</option>
              </select>
            </label>
            <label>
              B.O. / REDS
              <input
                name="police_report"
                maxLength={200}
                defaultValue={o.details.police_report ?? ""}
              />
            </label>
            <label className="span-2">
              Observações
              <textarea
                name="observation"
                maxLength={5000}
                defaultValue={o.details.observation ?? ""}
              />
            </label>
            <div>
              <button>Salvar alterações</button>
            </div>
          </form>
        </section>
      )}
      <section className="card">
        <h2>Mensagens da ordem</h2>
        {canPost && (
          <form action={addMessage}>
            <input type="hidden" name="id" value={id} />
            <label>
              Nova mensagem
              <textarea name="body" required maxLength={5000} rows={3} />
            </label>
            <button>Enviar mensagem</button>
          </form>
        )}
        <div className="timeline">
          {messages.data?.map((m) => (
            <article key={m.id}>
              <strong>
                {m.author_id === user.id ? "Você" : "Equipe da ordem"}
              </strong>
              <small>{date(m.created_at)}</small>
              <p>{m.body}</p>
            </article>
          ))}
          {!messages.data?.length && (
            <p className="empty">Nenhuma mensagem registrada.</p>
          )}
        </div>
        <small className="muted">Até 100 mensagens recentes.</small>
      </section>
    </>
  );
}
