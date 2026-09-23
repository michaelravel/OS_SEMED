import { login } from "@/app/actions";
import { configured } from "@/lib/supabase";
import Link from "next/link";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  return (
    <main className="login-page">
      <section className="login-brand">
        <span className="brand">
          SIGMA <b>SEMED</b>
        </span>
        <div>
          <p className="eyebrow">GESTÃO, MONITORAMENTO E APRENDIZAGEM</p>
          <h1>
            Cuidar da estrutura.
            <br />
            Apoiar a educação.
          </h1>
          <p>
            Ordens de serviço, equipes e logística conectadas às necessidades da
            rede municipal.
          </p>
        </div>
        <small>Secretaria Municipal de Educação · OS SEMED</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">ORDENS DE SERVIÇO</span>
          <h2>Bem-vindo ao OS SEMED</h2>
          <p className="muted">Acesse com sua conta institucional.</p>
          {erro && (
            <p role="alert" className="notice danger">
              Não foi possível entrar. Verifique suas credenciais e tente
              novamente.
            </p>
          )}
          {configured() ? (
            <form action={login}>
              <label>
                E-mail institucional
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                />
              </label>
              <label>
                Senha
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={200}
                />
              </label>
              <button>Entrar no sistema →</button>
            </form>
          ) : (
            <p className="notice">
              Ambiente aguardando configuração.{" "}
              <Link href="/configuracao">Ver orientação</Link>
            </p>
          )}
          <small className="muted">
            O acesso depende de um vínculo autorizado pela Secretaria.
          </small>
        </div>
      </section>
    </main>
  );
}
