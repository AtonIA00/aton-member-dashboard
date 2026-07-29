import type { Deltas, Kpis } from "@/lib/leads";
import type { Delta } from "@/lib/deltas";
import { GRUPO_LABEL } from "@/lib/classify";

type Props = {
  kpis: Kpis;
  /** KPIs do período anterior — usado pro contexto "X no período anterior". */
  kpisPrevious: Kpis | null;
  /** Deltas por KPI. null = "Todo período" ou sem referência → chips ocultos. */
  deltas: Deltas | null;
};

function pct(n: number): string {
  return (n * 100).toFixed(1).replace(".", ",") + "%";
}

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

type Card = {
  label: string;
  value: string;
  /** Valor "atual" e "anterior" pra tooltip + sub-linha contextual. */
  valuePrevious?: string;
  sub?: string;
  /** Aviso de qualidade do dado (ex.: cobertura de classificação de MQL).
   *  Renderizado em âmbar abaixo do sub — sinaliza "leia com ressalva". */
  warn?: string;
  warnTitle?: string;
  accent: "cyan" | "green" | "amber" | "neutral";
  delta?: Delta;
};

const ACCENT_BAR: Record<Card["accent"], string> = {
  // accent name "cyan" preservado por compat, mas pinta com aton-blue agora.
  cyan: "from-[color:var(--primary)]",
  green: "from-[#10b981]",
  amber: "from-[#f59e0b]",
  neutral: "from-[color:var(--muted-foreground)]",
};

const CHIP_STYLE: Record<Delta["classification"], string> = {
  // outline: border + texto colorido, sem fundo. Cores literais com
  // contraste OK em ambos os temas (success/destructive da paleta Aton).
  positive: "border-[#10b981]/55 text-[#10b981]",
  negative: "border-[color:var(--destructive)]/55 text-[color:var(--destructive)]",
  neutral: "border-[color:var(--muted-foreground)]/40 text-[color:var(--muted-foreground)]",
};

function deltaTooltip(currentLabel: string, previousLabel: string): string {
  return `Atual: ${currentLabel} | Anterior: ${previousLabel}`;
}

export function KpiRow({ kpis, kpisPrevious, deltas }: Props) {
  // Cobertura da classificação de MQL. A mqlRate divide pelo TOTAL, então
  // lead sem `mql` preenchido conta como não-MQL → a taxa é um PISO. Avisa
  // a partir de 20% sem classificação (abaixo disso a distorção é marginal).
  const semMql = kpis.mqlSemClassificacao;
  const pctSemMql = kpis.total > 0 ? semMql / kpis.total : 0;
  const mqlWarn =
    pctSemMql >= 0.2
      ? `⚠ ${pct(pctSemMql)} sem classificação — taxa é piso`
      : undefined;

  const cards: Card[] = [
    {
      label: "Total de Leads",
      value: int(kpis.total),
      valuePrevious: kpisPrevious ? int(kpisPrevious.total) : undefined,
      accent: "cyan",
      delta: deltas?.total,
    },
    {
      label: "% Interação",
      value: pct(kpis.pctInteracao),
      valuePrevious: kpisPrevious ? pct(kpisPrevious.pctInteracao) : undefined,
      sub: `${int(kpis.interagiram)} / ${int(kpis.total)}`,
      accent: "cyan",
      delta: deltas?.pctInteracao,
    },
    {
      label: "MQL Rate",
      value: pct(kpis.mqlRate),
      valuePrevious: kpisPrevious ? pct(kpisPrevious.mqlRate) : undefined,
      sub: `${int(kpis.mqlSim)} qualificados de ${int(kpis.total)}`,
      warn: mqlWarn,
      warnTitle: mqlWarn
        ? `${int(semMql)} de ${int(kpis.total)} leads estão sem MQL preenchido (nem "sim" nem "não"). Eles entram no denominador como não-MQL, então a taxa real pode ser maior. Entre os ${int(kpis.total - semMql)} leads classificados, ${pct(kpis.total - semMql > 0 ? kpis.mqlSim / (kpis.total - semMql) : 0)} são MQL.`
        : undefined,
      accent: "green",
      delta: deltas?.mqlRate,
    },
    {
      label: GRUPO_LABEL["Agendado+"],
      value: int(kpis.agendadoPlus),
      valuePrevious: kpisPrevious ? int(kpisPrevious.agendadoPlus) : undefined,
      sub: `${pct(kpis.pctAgendamento)} do total`,
      accent: "amber",
      delta: deltas?.agendadoPlus,
    },
    {
      label: "Anúncios ativos",
      value: int(kpis.anunciosAtivos),
      valuePrevious: kpisPrevious ? int(kpisPrevious.anunciosAtivos) : undefined,
      sub: "distintos",
      accent: "neutral",
      delta: deltas?.anunciosAtivos,
    },
    {
      label: "Campanhas ativas",
      value: int(kpis.campanhasAtivas),
      valuePrevious: kpisPrevious ? int(kpisPrevious.campanhasAtivas) : undefined,
      sub: "distintas",
      accent: "neutral",
      delta: deltas?.campanhasAtivas,
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
          {c.warn && (
            <div
              title={c.warnTitle}
              className="mt-1 cursor-help text-[10px] font-semibold leading-tight text-[#d97706] dark:text-[#fbbf24]"
            >
              {c.warn}
            </div>
          )}
          {c.delta && c.valuePrevious !== undefined && (
            <>
              <div
                title={deltaTooltip(c.value, c.valuePrevious)}
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
