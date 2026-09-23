import { logout } from "@/app/actions";
export default function NoAccess() {
  return (
    <main className="access-page">
      <section className="access-card">
        <span className="brand">
          SIGMA <b>SEMED</b>
        </span>
        <h1>Vínculo necessário</h1>
        <p>
          Sua conta não possui um vínculo ativo com o OS SEMED. Solicite a
          liberação ao administrador da Secretaria.
        </p>
        <form action={logout}>
          <button>Sair</button>
        </form>
      </section>
    </main>
  );
}
