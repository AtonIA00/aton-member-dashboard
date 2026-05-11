export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Glow ciano de fundo — identidade Aton */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(0, 229, 255, 0.18) 0%, rgba(0, 229, 255, 0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(40% 40% at 80% 90%, rgba(0, 229, 255, 0.10) 0%, rgba(0, 229, 255, 0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--card)]/60 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--primary)] backdrop-blur">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--primary)]" />
          Aton IA
        </div>

        <h1 className="font-[family-name:var(--font-montserrat)] text-4xl font-extrabold leading-tight tracking-tight text-[color:var(--foreground)] sm:text-5xl md:text-6xl">
          Member Dashboard
          <span className="block bg-gradient-to-r from-[color:var(--primary)] to-[#69F0AE] bg-clip-text text-transparent">
            em construção
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-base leading-relaxed text-[color:var(--muted-foreground)] sm:text-lg">
          Em breve, o BI self-service da sua workspace. Leads, campanhas, anúncios e qualificação em tempo real — direto do painel da Aton.
        </p>

        <div className="mt-10 grid w-full max-w-md grid-cols-3 gap-3 text-left">
          {[
            { label: "Leads", value: "—" },
            { label: "Campanhas", value: "—" },
            { label: "MQL Rate", value: "—" },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-4 backdrop-blur"
            >
              <div className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-[color:var(--foreground)]">
                {kpi.value}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                {kpi.label}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-xs text-[color:var(--muted-foreground)]">
          <span className="font-mono">member-dashboard.aton-ia.com.br</span>
          <span className="mx-2 opacity-50">·</span>
          <span>Marco 1 — Fundação</span>
        </div>
      </div>
    </main>
  );
}
