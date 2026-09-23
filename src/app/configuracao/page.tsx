import Link from "next/link";
export default function Setup() {
  return (
    <main className="access-page">
      <section className="access-card">
        <span className="brand">
          SIGMA <b>SEMED</b>
        </span>
        <h1>OS SEMED</h1>
        <p>A conexão com o ambiente ainda não foi configurada.</p>
        <p>
          O administrador deve configurar o projeto Supabase e aplicar as
          migrations antes de liberar o acesso.
        </p>
        <Link className="button" href="/login">
          Ir para o acesso
        </Link>
      </section>
    </main>
  );
}
