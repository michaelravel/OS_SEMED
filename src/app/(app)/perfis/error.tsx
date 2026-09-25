"use client";

export default function AccessProfilesError({ reset }: { reset: () => void }) {
  return (
    <section className="card">
      <h1>Perfis e Permissões</h1>
      <p className="notice danger" role="alert">
        Não foi possível carregar os perfis e permissões.
      </p>
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
    </section>
  );
}
