import Link from "next/link";
import { session } from "@/lib/session";
import { isOrderStatus, orderStatuses } from "@/lib/domain";
import { Heading, Badge, Pagination, date } from "@/components/ui";
import { pageNumber, pageRange } from "@/lib/pagination";
import { ensureQuerySucceeded } from "@/lib/errors";
import { fieldLimits } from "@/lib/application-config";
export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const p = await searchParams;
  const page = pageNumber(p.page);
  const range = pageRange(page);
  const q = (p.q ?? "").slice(0, 100);
  const { db } = await session();
  let query = db
    .from("os_orders")
    .select("id,protocol,title,status,priority,created_at", { count: "exact" })
    .eq("active", true)
    .order("created_at", { ascending: false })
    .range(range.from, range.to);
  if (q) {
    const protocol = q.match(/^(?:OS-?)?0*(\d+)$/i)?.[1];
    query = protocol
      ? query.eq("protocol", Number(protocol))
      : query.ilike("title", `%${q.replace(/[%_\\]/g, "")}%`);
  }
  if (p.status && isOrderStatus(p.status))
    query = query.eq("status", p.status);
  const { data, error, count } = await query;
  ensureQuerySucceeded({ error }, "Falha ao consultar ordens");
  return (
    <>
      <Heading
        title="Ordens de serviço"
        description="Consulte e acompanhe as solicitações da rede."
      />
      <form className="filters">
        <label>
          Buscar
          <input
            name="q"
            defaultValue={q}
            placeholder="Título ou protocolo OS-000001"
            maxLength={fieldLimits.search}
          />
        </label>
        <label>
          Situação
          <select name="status" defaultValue={p.status ?? ""}>
            <option value="">Todas</option>
            {orderStatuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button>Filtrar</button>
      </form>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Identificador</th>
              <th>Solicitação</th>
              <th>Situação</th>
              <th>Prioridade</th>
              <th>Registro</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((o) => (
              <tr key={o.id}>
                <td>OS-{String(o.protocol).padStart(6, "0")}</td>
                <td>{o.title}</td>
                <td>
                  <Badge status={o.status} />
                </td>
                <td>{o.priority}</td>
                <td>{date(o.created_at)}</td>
                <td>
                  <Link href={`/ordens/${o.id}`}>Ver detalhes →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.length && <p className="empty">Nenhuma ordem encontrada.</p>}
        <Pagination
          page={page}
          total={count ?? 0}
          base={`/ordens?q=${encodeURIComponent(q)}&status=${encodeURIComponent(p.status ?? "")}`}
        />
      </section>
    </>
  );
}
