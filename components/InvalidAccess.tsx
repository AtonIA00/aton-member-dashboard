export function InvalidAccess() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(255, 82, 82, 0.10) 0%, rgba(255, 82, 82, 0) 70%)",
        }}
      />

      <div className="relative w-full max-w-xl text-center">
        <div
          className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--card)]/80 backdrop-blur"
          aria-hidden
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[color:var(--destructive)]"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1 className="font-[family-name:var(--font-montserrat)] text-3xl font-bold leading-tight tracking-tight text-[color:var(--foreground)] sm:text-4xl">
          Acesso inválido
        </h1>

        <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-[color:var(--muted-foreground)] sm:text-lg">
          Volte ao painel da Aton e tente novamente. Se o problema persistir,
          fale com o suporte:{" "}
          <a
            href="mailto:suporte@atonbot.cc"
            className="font-medium text-[color:var(--primary)] hover:underline"
          >
            suporte@atonbot.cc
          </a>
          .
        </p>

        <div className="mt-12 text-xs text-[color:var(--muted-foreground)]">
          <span className="font-mono">member-dashboard.aton-ia.com.br</span>
        </div>
      </div>
    </main>
  );
}
