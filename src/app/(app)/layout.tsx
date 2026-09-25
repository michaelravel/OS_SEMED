import { session } from "@/lib/session";
import { canOpen } from "@/lib/domain";
import { Shell } from "@/components/shell";
import { getUserPermissions } from "@/lib/authorization";
import { permissionSetHas } from "@/lib/authorization-core";
import { routePermissions } from "@/lib/authorization-policy";
export const dynamic = "force-dynamic";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, admin, memberships, db } = await session();
  const permissions = await getUserPermissions(db);
  return (
    <Shell
      name={user.email ?? "Conta institucional"}
      admin={admin}
      permissions={[...permissions]}
      canCreate={
        canOpen(memberships) &&
        permissionSetHas(permissions, routePermissions.newOrder)
      }
    >
      {children}
    </Shell>
  );
}
