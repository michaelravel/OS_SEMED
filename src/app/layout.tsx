import type { Metadata } from "next";
import "./globals.css";
// A política CSP usa um nonce novo por requisição; por isso toda a árvore deve
// ser renderizada dinamicamente para que o Next.js aplique o nonce aos scripts.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "OS SEMED | SIGMA",
  description:
    "Gestão de ordens de serviço da Secretaria Municipal de Educação",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
