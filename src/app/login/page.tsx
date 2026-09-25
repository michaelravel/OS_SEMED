import { login, loginWithGoogle } from "@/app/actions";
import { configured } from "@/lib/supabase";
import { fieldLimits } from "@/lib/application-config";
import Link from "next/link";
import { allowedGoogleDomains } from "@/lib/professional-identity";

const oauthMessages: Record<string, string> = {
  "nao-cadastrado": "Seu e-mail institucional ainda não possui cadastro ativo no OS SEMED. Solicite a liberação à administração.",
  inativo: "Seu cadastro profissional está inativo. Procure a administração do OS SEMED.",
  dominio: "Esta conta Google não pertence a um domínio institucional autorizado.",
  "conflito-identidade": "A identidade desta conta não pôde ser vinculada com segurança. Procure a administração.",
  "provedor-invalido": "Use uma conta Google Workspace com e-mail confirmado.",
  "callback-invalido": "Não foi possível concluir a autenticação com o Google. Tente novamente.",
  indisponivel: "O acesso institucional está temporariamente indisponível. Tente novamente.",
  configuracao: "O acesso Google Workspace ainda precisa ser configurado neste ambiente.",
};
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; logout?: string; oauth?: string }>;
}) {
  const { erro, logout, oauth } = await searchParams;
  const googleConfigured = allowedGoogleDomains().length > 0;
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
          {logout === "erro" && (
            <p role="alert" className="notice danger">
              Não foi possível confirmar o encerramento completo da sessão.
              Feche esta janela se estiver em um computador compartilhado e
              tente sair novamente antes de continuar.
            </p>
          )}
          {oauth && (
            <p role="alert" className="notice danger">
              {oauthMessages[oauth] ?? oauthMessages.indisponivel}
            </p>
          )}
          {configured() ? (
            <>
              <form action={loginWithGoogle} className="google-login-form">
                <button className="google-login" disabled={!googleConfigured}>
                  <span aria-hidden="true">G</span>
                  Entrar com Google Workspace
                </button>
              </form>
              <div className="login-divider"><span>Acesso legado temporário</span></div>
              <form action={login}>
              <label>
                E-mail institucional
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={fieldLimits.email}
                />
              </label>
              <label>
                Senha
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={fieldLimits.password}
                />
              </label>
              <button>Entrar no sistema →</button>
              </form>
            </>
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
