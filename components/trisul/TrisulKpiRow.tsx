import type { Delta } from "@/lib/deltas";
import type { TrisulKpis, TrisulDeltas } from "@/lib/trisul";

type Props = {
  kpis: TrisulKpis;
  kpisPrevious: TrisulKpis | null;
  deltas: TrisulDeltas | null;
};

function pct(n: number): string {
  return (n * 100).toFixed(1).replace(".", ",") + "%";
}
function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

type Accent = "cyan" | "green" | "amber" | "neutral";

const ACCENT_BAR: Record<Accent, string> = {
  cyan: "from-[color:var(--primary)]",
  green: "from-[#10b981]",
  amber: "from-[#f59e0b]",
  neutral: "from-[color:var(--muted-foreground)]",
};

const CHIP_STYLE: Record<Delta["classification"], string> = {
  positive: "border-[#10b981]/55 text-[#10b981]",
  negative: "border-[color:var(--destructive)]/55 text-[color:var(--destructive)]",
  neutral: "border-[color:var(--muted-foreground)]/40 text-[color:var(--muted-foreground)]",
};

type Card = {
  label: string;
  value: string;
  valuePrevious?: string;
  sub?: string;
  accent: Accent;
  delta?: Delta;
};

export function TrisulKpiRow({ kpis, kpisPrevious, deltas }: Props) {
  const cards: Card[] = [
    {
      label: "Disparos",
      value: int(kpis.disparos),
      valuePrevious: kpisPrevious ? int(kpisPrevious.disparos) : undefined,
      sub: "volume enviado",
      accent: "cyan",
      delta: deltas?.disparos,
    },
    {
      label: "Taxa de resposta",
      value: pct(kpis.taxaResposta),
      valuePrevious: kpisPrevious ? pct(kpisPrevious.taxaResposta) : undefined,
      sub: `${int(kpis.respostas)} / ${int(kpis.disparos)}`,
      accent: "cyan",
      delta: deltas?.taxaResposta,
    },
    {
      label: "Contatos ativos",
      value: pct(kpis.taxaAtivos),
      valuePrevious: kpisPrevious ? pct(kpisPrevious.taxaAtivos) : undefined,
      sub: `${int(kpis.ativosConfirmados)} confirmados`,
      accent: "green",
      delta: deltas?.taxaAtivos,
    },
    {
      label: "Conversão",
      value: pct(kpis.conversao),
      valuePrevious: kpisPrevious ? pct(kpisPrevious.conversao) : undefined,
      sub: "ativos / disparos",
      accent: "green",
      delta: deltas?.conversao,
    },
    {
      label: "Atuam c/ parcerias",
      value: pct(kpis.pctAtuam),
      valuePrevious: kpisPrevious ? pct(kpisPrevious.pctAtuam) : undefined,
      sub: "sobre respostas",
      accent: "amber",
      delta: deltas?.pctAtuam,
    },
    {
      label: "Contato c/ coordenador",
      value: pct(kpis.pctContatoCoord),
      valuePrevious: kpisPrevious ? pct(kpisPrevious.pctContatoCoord) : undefined,
      sub: "sobre respostas",
      accent: "neutral",
      delta: deltas?.pctContatoCoord,
    },
  ];

  return (
    <section
      aria-label="Indicadores principais"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-5 backdrop-blur transition-colors hover:border-[color:var(--primary)]/30"
        >
          <div
            aria-hidden
            className={`absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b ${ACCENT_BAR[c.accent]} to-transparent opacity-80`}
          />
          <div className="font-[family-name:var(--font-montserrat)] text-3xl font-bold leading-none text-[color:var(--foreground)]">
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
          {c.delta && c.valuePrevious !== undefined && (
            <>
              <div
                title={`Atual: ${c.value} | Anterior: ${c.valuePrevious}`}
                className={
                  "mt-3 inline-flex h-[26px] items-center rounded-full border bg-transparent px-3 text-[12px] font-medium " +
                  CHIP_STYLE[c.delta.classification]
                }
              >
                {c.delta.formatted}
              </div>
              {c.delta.direction !== "new" && (
                <div className="mt-1 truncate text-[11px] text-[color:var(--muted-foreground)]/70">
                  {c.valuePrevious} no período anterior
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
