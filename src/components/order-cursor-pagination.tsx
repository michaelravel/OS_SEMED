import Link from "next/link";

export function OrderCursorPagination({
  previousHref,
  nextHref,
  pageSize,
}: {
  previousHref?: string;
  nextHref?: string;
  pageSize: number;
}) {
  return (
    <nav className="pagination" aria-label="Paginação das ordens">
      <span>Até {pageSize} ordens por página</span>
      <div className="row">
        {previousHref && <Link href={previousHref}>← Anteriores</Link>}
        {nextHref && <Link href={nextHref}>Próximas →</Link>}
      </div>
    </nav>
  );
}
