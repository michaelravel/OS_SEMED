import { redirect } from "next/navigation";
import { session } from "@/lib/session";
import { canOpen } from "@/lib/domain";
import { Heading, Notice } from "@/components/ui";
import { OrderForm } from "@/components/order-form";
import { queryLimits } from "@/lib/application-config";
import { ensureQueriesSucceeded } from "@/lib/errors";
export default async function NewOrder({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { db, memberships } = await session();
  if (!canOpen(memberships)) redirect("/ordens");
  const [{ data: units, error: uError }, { data: catalogs, error: cError }] =
    await Promise.all([
      db
        .from("os_units")
        .select("id,name")
        .eq("active", true)
        .order("name")
        .limit(queryLimits.lookupRows),
      db
        .from("os_catalogs")
        .select("id,kind,name,data")
        .eq("active", true)
        .order("name")
        .limit(queryLimits.lookupRows),
    ]);
  ensureQueriesSucceeded(
    [{ error: uError }, { error: cError }],
    "Falha ao consultar cadastros",
  );
  return (
    <>
      <Heading
        title="Nova ordem de serviço"
        description="Registre uma necessidade da sua unidade."
      />
      <Notice error={(await searchParams).erro} />
      <OrderForm
        units={units ?? []}
        categories={
          (catalogs ?? []).filter((catalog) => catalog.kind === "logistics")
        }
        catalogs={catalogs ?? []}
      />
    </>
  );
}
