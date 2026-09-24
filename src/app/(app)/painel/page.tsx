import Link from "next/link";
import { session } from "@/lib/session";
import { Heading, Badge, date } from "@/components/ui";
import {
  ClipboardList,
  Clock3,
  CircleCheck,
  Building2,
  ArrowUpRight,
} from "lucide-react";
export default async function Dashboard() {
  const { db } = await session();
  const [all, pending, done, units, recent] = await Promise.all([
    db
      .from("os_orders")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    db
      .from("os_orders")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .not("status", "in", '("Concluída","Cancelada")'),
    db
      .from("os_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "Concluída")
      .eq("active", true),
    db
      .from("os_units")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    db
      .from("os_orders")
      .select("id,protocol,title,status,created_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  if ([all, pending, done, units, recent].some((r) => r.error))
    throw new Error("Falha ao consultar painel");
  const cards = [
    ["Ordens de serviço", all.count, ClipboardList],
    ["Em acompanhamento", pending.count, Clock3],
    ["Concluídas", done.count, CircleCheck],
    ["Unidades disponíveis", units.count, Building2],
  ] as const;
  return (
    <>
      <Heading
        title="Visão geral"
        description="Acompanhe os serviços e as necessidades das unidades da rede."
      />
      <section className="welcome">
        <div>
          <span className="eyebrow">REDE MUNICIPAL DE EDUCAÇÃO</span>
          <h2>
            Uma rede conectada.
            <br />
            Cada solicitação acompanhada.
          </h2>
          <p>
            Organize demandas, acompanhe as equipes e mantenha
            <br />o cuidado com nossas unidades em dia.
          </p>
          <Link href="/ordens">
            Acompanhar ordens <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="welcome-mark" aria-hidden="true">
          <Building2 size={100} strokeWidth={1} />
          <span>OS / SEMED</span>
        </div>
      </section>
      <section className="stats">
        {cards.map(([label, value, Icon]) => (
          <article className="stat card" key={label}>
            <div>
              <span>{label}</span>
              <strong>{value ?? 0}</strong>
              <small>Conforme seus vínculos</small>
            </div>
            <Icon size={23} />
          </article>
        ))}
      </section>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Últimas ordens de serviço</h2>
            <p className="muted">
              Solicitações mais recentes disponíveis para você.
            </p>
          </div>
          <Link href="/ordens">Ver todas →</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Solicitação</th>
                <th>Situação</th>
                <th>Registro</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {recent.data?.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.title}</strong>
                    <small>OS-{String(o.protocol).padStart(6, "0")}</small>
                  </td>
                  <td>
                    <Badge status={o.status} />
                  </td>
                  <td>{date(o.created_at)}</td>
                  <td>
                    <Link href={`/ordens/${o.id}`}>Abrir →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!recent.data?.length && (
            <div className="empty">
              <ClipboardList size={36} />
              <h3>Nenhuma ordem disponível</h3>
              <p>
                As solicitações aparecerão aqui conforme seus vínculos e a
                importação dos dados.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
