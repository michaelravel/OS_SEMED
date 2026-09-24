import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import {
  buildContentSecurityPolicy,
  isPrivateRoute,
} from "@/lib/web-security";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: url,
    development: isDevelopment,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const secure = <T extends NextResponse>(next: T) => {
    next.headers.set("Content-Security-Policy", csp);
    next.headers.set("Cache-Control", "private, no-store");
    return next;
  };
  const createResponse = () =>
    secure(NextResponse.next({ request: { headers: requestHeaders } }));
  let response = createResponse();
  if (!url || !key) return response;
  const db = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        requestHeaders.set("cookie", request.cookies.toString());
        response = createResponse();
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  let authenticated = false;
  try {
    const { data, error } = await db.auth.getClaims();
    authenticated = !error && Boolean(data?.claims?.sub);
  } catch {
    // Uma indisponibilidade do Auth não pode liberar uma rota privada.
  }

  // Esta é uma checagem antecipada. Server Components, Server Actions e RLS
  // continuam responsáveis pela autorização definitiva.
  if (isPrivateRoute(request.nextUrl.pathname) && !authenticated) {
    const login = new URL("/login", request.url);
    const redirect = secure(NextResponse.redirect(login, 303));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
