import Link from "next/link";
export function Heading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="heading">
      <p className="eyebrow">OS SEMED</p>
      <h1>{title}</h1>
      <p className="muted">{description}</p>
    </div>
  );
}
export function Notice({ error }: { error?: string }) {
  return error ? (
    <p className="notice danger" role="alert">
      Não foi possível salvar. Verifique os campos e suas permissões e tente
      novamente.
    </p>
  ) : null;
}
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${status === "Concluída" ? "success" : status === "Cancelada" ? "danger" : status === "A conferir" ? "warning" : ""}`}
    >
      {status}
    </span>
  );
}
export function Pagination({
  page,
  total,
  base,
}: {
  page: number;
  total: number;
  base: string;
}) {
  return (
    <div className="pagination">
      <span>
        {total} registros · Página {page}
      </span>
      <div className="row">
        {page > 1 && (
          <Link
            href={`${base}${base.includes("?") ? "&" : "?"}page=${page - 1}`}
          >
            ← Anterior
          </Link>
        )}
        {page * 25 < total && (
          <Link
            href={`${base}${base.includes("?") ? "&" : "?"}page=${page + 1}`}
          >
            Próxima →
          </Link>
        )}
      </div>
    </div>
  );
}
export function pageNumber(value?: string) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1;
}
export function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "Não informada";
}
