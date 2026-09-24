import type { NextConfig } from "next";
import { baseSecurityHeaders } from "./src/lib/web-security";

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...baseSecurityHeaders,
          ...(process.env.NODE_ENV === "production" && !process.env.VERCEL
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};
export default config;
