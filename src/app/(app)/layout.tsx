import { session } from "@/lib/session";
import { Shell } from "@/components/shell";
import { getUserPermissions } from "@/lib/authorization";
export const dynamic = "force-dynamic";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, admin, db } = await session();
  const permissions = await getUserPermissions(db);
  return (
    <Shell
      name={user.email ?? "Conta institucional"}
      admin={admin}
      permissions={[...permissions]}
    >
      {children}
    </Shell>
  );
}
