import Link from "next/link";
export default function NotFound() {
  return (
    <main className="access-page">
      <section className="access-card">
        <h1>Registro não encontrado</h1>
        <p>O registro não existe ou não está disponível para seu vínculo.</p>
        <Link href="/">Voltar ao início</Link>
      </section>
    </main>
  );
}
