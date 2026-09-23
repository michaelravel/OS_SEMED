import { redirect } from "next/navigation";
import { session } from "@/lib/session";
import { canOpen, type Unit, type Catalog } from "@/lib/domain";
import { Heading, Notice } from "@/components/ui";
import { OrderForm } from "@/components/order-form";
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
        .select("id,name,type,address,coordinates,active")
        .eq("active", true)
        .order("name")
        .limit(1000),
      db
        .from("os_catalogs")
        .select("id,legacy_id,kind,name,data,active")
        .eq("active", true)
        .order("name")
        .limit(1000),
    ]);
  if (uError || cError) throw new Error("Falha ao consultar cadastros");
  return (
    <>
      <Heading
        title="Nova ordem de serviço"
        description="Registre uma necessidade da sua unidade."
      />
      <Notice error={(await searchParams).erro} />
      <OrderForm
        units={(units ?? []) as Unit[]}
        categories={
          (catalogs ?? []).filter((c) => c.kind === "logistics") as Catalog[]
        }
        catalogs={(catalogs ?? []) as Catalog[]}
      />
    </>
  );
}
