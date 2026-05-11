import type { Tier } from "@/lib/access";

type Props = {
  workspaceName: string;
  userName: string;
  tier: Tier;
  daysUntilExpiry: number | null;
};

const TIER_LABEL: Record<Tier, string> = {
  trial: "Trial",
  pro: "Pro",
  enterprise: "Enterprise",
};

function TierBadge({ tier, daysUntilExpiry }: Pick<Props, "tier" | "daysUntilExpiry">) {
  const isTrial = tier === "trial";
  const expiryText =
    isTrial && daysUntilExpiry !== null
      ? ` — expira em ${daysUntilExpiry}d`
      : "";

  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] " +
        (isTrial
          ? "border-[#FFD740]/40 bg-[#FFD740]/10 text-[#FFD740]"
          : "border-[color:var(--primary)]/40 bg-[color:var(--primary)]/10 text-[color:var(--primary)]")
      }
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        aria-hidden
      />
      {TIER_LABEL[tier]}
      {expiryText}
    </span>
  );
}

export function GrantedPlaceholder({
  workspaceName,
  userName,
  tier,
  daysUntilExpiry,
}: Props) {
  const greeting = userName ? `Olá, ${userName.split(" ")[0]}` : "Olá";

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(0, 229, 255, 0.18) 0%, rgba(0, 229, 255, 0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
        {/* Header compacto pra caber em iframe estreito */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
              Aton · Member Dashboard
            </div>
            <h1 className="mt-1 truncate font-[family-name:var(--font-montserrat)] text-xl font-bold text-[color:var(--foreground)] sm:text-2xl">
              {workspaceName}
            </h1>
          </div>
          <TierBadge tier={tier} daysUntilExpiry={daysUntilExpiry} />
        </header>

        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          {greeting}. Em breve, o painel completo de leads, campanhas e
          qualificação chega aqui.
        </p>

        {/* KPIs skeleton — placeholder dos cards reais (M3) */}
        <section
          aria-label="Indicadores em breve"
          className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {[
            { label: "Total de Leads" },
            { label: "% Interação" },
            { label: "MQL Rate" },
            { label: "Agendamento+" },
            { label: "Anúncios ativos" },
            { label: "Campanhas ativas" },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="relative overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-4 backdrop-blur"
            >
              {/* Shimmer estático (sem JS) — barra esquerda ciano simulando dado vindo */}
              <div
                aria-hidden
                className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[color:var(--primary)] to-transparent opacity-60"
              />
              <div className="font-[family-name:var(--font-montserrat)] text-2xl font-bold leading-none text-[color:var(--muted-foreground)]/70">
                —
              </div>
              <div className="mt-2 text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                {kpi.label}
              </div>
            </div>
          ))}
        </section>

        <section className="mt-8 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-5 backdrop-blur">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[color:var(--primary)]/15 text-[color:var(--primary)]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-[family-name:var(--font-montserrat)] text-sm font-semibold text-[color:var(--foreground)]">
                Em breve, seu dashboard
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                Estamos finalizando os filtros, gráficos e a tabela detalhada de
                leads. Você verá tudo aqui assim que liberarmos.
              </p>
            </div>
          </div>
        </section>

        <div className="mt-auto pt-8 text-center text-xs text-[color:var(--muted-foreground)]">
          <span className="font-mono">member-dashboard.aton-ia.com.br</span>
          <span className="mx-2 opacity-50">·</span>
          <span>Marco 2 — Gate de acesso</span>
        </div>
      </div>
    </main>
  );
}
