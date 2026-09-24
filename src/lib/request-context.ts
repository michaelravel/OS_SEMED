import "server-only";
import { headers } from "next/headers";
import { normalizeRequestId } from "./observability";

export async function currentRequestId() {
  const requestHeaders = await headers();
  return (
    normalizeRequestId(requestHeaders.get("x-request-id")) ??
    crypto.randomUUID()
  );
}
