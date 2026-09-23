import { redirect } from "next/navigation";
import { session } from "@/lib/session";
import { Heading, Pagination, pageNumber, date } from "@/components/ui";
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { db, admin } = await session();
  if (!admin) redirect("/painel");
  const page = pageNumber((await searchParams).page);
  const { data, error, count } = await db
    .from("os_audit")
    .select("id,actor,entity,record_id,action,created_at", { count: "exact" })
    .order("id", { ascending: false })
    .range((page - 1) * 25, page * 25 - 1);
  if (error) throw new Error("Falha ao consultar auditoria");
  return (
    <>
      <Heading
        title="Auditoria"
        description="Registro das alterações realizadas no banco de dados."
      />
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Ação</th>
              <th>Entidade</th>
              <th>Registro</th>
              <th>Autor</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((a) => (
              <tr key={a.id}>
                <td>{date(a.created_at)}</td>
                <td>{a.action}</td>
                <td>{a.entity}</td>
                <td>{a.record_id}</td>
                <td>{a.actor ?? "Importação / operação administrativa"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} total={count ?? 0} base="/auditoria" />
      </section>
    </>
  );
}
