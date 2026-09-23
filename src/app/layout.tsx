import type { Metadata } from "next";
import "./globals.css";
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
