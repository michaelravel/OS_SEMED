import { session } from "@/lib/session";
import { canOpen } from "@/lib/domain";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, admin, memberships } = await session();
  return (
    <Shell
      name={user.email ?? "Conta institucional"}
      admin={admin}
      canCreate={canOpen(memberships)}
    >
      {children}
    </Shell>
  );
}
