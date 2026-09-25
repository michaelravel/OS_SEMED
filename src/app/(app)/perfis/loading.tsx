export default function AccessProfilesLoading() {
  return (
    <>
      <div className="heading">
        <p className="eyebrow">OS SEMED</p>
        <h1>Perfis e Permissões</h1>
        <p className="muted">Carregando perfis e matriz de permissões...</p>
      </div>
      <section className="card" aria-busy="true" aria-live="polite">
        <p className="empty">Carregando dados de autorização...</p>
      </section>
    </>
  );
}
