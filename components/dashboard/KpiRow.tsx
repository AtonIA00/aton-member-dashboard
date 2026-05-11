import type { Kpis } from "@/lib/leads";

type Props = { kpis: Kpis };

function pct(n: number): string {
  return (n * 100).toFixed(1).replace(".", ",") + "%";
}

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

type Card = {
  label: string;
  value: string;
  sub?: string;
  accent?: "cyan" | "green" | "amber" | "neutral";
};

const ACCENT_BAR: Record<NonNullable<Card["accent"]>, string> = {
  cyan: "from-[color:var(--primary)]",
  green: "from-[#69F0AE]",
  amber: "from-[#FFD740]",
  neutral: "from-[color:var(--muted-foreground)]",
};

const ACCENT_TEXT: Record<NonNullable<Card["accent"]>, string> = {
  cyan: "text-[color:var(--foreground)]",
  green: "text-[color:var(--foreground)]",
  amber: "text-[color:var(--foreground)]",
  neutral: "text-[color:var(--foreground)]",
};

export function KpiRow({ kpis }: Props) {
  const cards: Card[] = [
    {
      label: "Total de Leads",
      value: int(kpis.total),
      accent: "cyan",
    },
    {
      label: "% Interação",
      value: pct(kpis.pctInteracao),
      sub: `${int(kpis.interagiram)} / ${int(kpis.total)}`,
      accent: "cyan",
    },
    {
      label: "MQL Rate",
      value: pct(kpis.mqlRate),
      sub: `${int(kpis.mqlSim)} qualificados`,
      accent: "green",
    },
    {
      label: "Agendamento+",
      value: `${int(kpis.agendadoPlus)}`,
      sub: `${pct(kpis.pctAgendamento)} do total`,
      accent: "amber",
    },
    {
      label: "Anúncios ativos",
      value: int(kpis.anunciosAtivos),
      sub: "distintos",
      accent: "neutral",
    },
    {
      label: "Campanhas ativas",
      value: int(kpis.campanhasAtivas),
      sub: "distintas",
      accent: "neutral",
    },
  ];

  return (
    <section
      aria-label="Indicadores principais"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
    >
      {cards.map((c) => {
        const accent = c.accent ?? "neutral";
        return (
          <div
            key={c.label}
            className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-5 backdrop-blur transition-colors hover:border-[color:var(--primary)]/30"
          >
            <div
              aria-hidden
              className={`absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b ${ACCENT_BAR[accent]} to-transparent opacity-80`}
            />
            <div
              className={`font-[family-name:var(--font-montserrat)] text-3xl font-bold leading-none ${ACCENT_TEXT[accent]}`}
            >
              {c.value}
            </div>
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              {c.label}
            </div>
            {c.sub && (
              <div className="mt-1.5 truncate text-[11px] text-[color:var(--muted-foreground)]/80">
                {c.sub}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
