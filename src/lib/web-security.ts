export const publicRoutes = ["/login", "/configuracao"] as const;

export function isPrivateRoute(pathname: string) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return !publicRoutes.some((route) => normalized === route);
}

export const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "Referrer-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
] as const;

export function buildContentSecurityPolicy({
  nonce,
  supabaseUrl,
  development,
}: {
  nonce: string;
  supabaseUrl?: string;
  development: boolean;
}) {
  const connections = new Set(["'self'"]);

  try {
    const endpoint = supabaseUrl ? new URL(supabaseUrl) : null;
    if (endpoint) {
      connections.add(endpoint.origin);
      connections.add(`wss://${endpoint.host}`);
    }
  } catch {
    // A tela de configuração trata uma URL ausente ou inválida.
  }

  if (development) {
    connections.add("http:");
    connections.add("https:");
    connections.add("ws:");
    connections.add("wss:");
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${[...connections].join(" ")}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
