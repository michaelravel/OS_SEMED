"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="card">
      <h1>Não foi possível concluir</h1>
      <p>Tente novamente. Se o problema persistir, informe o administrador.</p>
      <button onClick={reset}>Tentar novamente</button>
    </section>
  );
}
