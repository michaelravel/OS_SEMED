import { redirect } from "next/navigation";
import { resolveFirstAuthorizedRoute } from "@/lib/authorization";
import { session } from "@/lib/session";

export default async function Home() {
  const { db, admin } = await session();
  redirect(await resolveFirstAuthorizedRoute(db, admin));
}
