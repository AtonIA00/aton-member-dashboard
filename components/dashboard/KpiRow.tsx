import type { Deltas, Kpis } from "@/lib/leads";
import type { Delta } from "@/lib/deltas";
import { GRUPO_LABEL } from "@/lib/classify";
import {
  METAS,
  VOLUME_MINIMO,
  faixaDaMeta,
  textoDaMeta,
  type Faixa,
  type Meta,
} from "@/lib/metas";

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
  /** Segunda sub-linha. Hoje só o card de MQL usa, pra manter visível a taxa
   *  sobre o total depois que o destaque virou o aproveitamento da conversa. */
  sub2?: string;
  /** Aviso de qualidade do dado (ex.: cobertura de classificação de MQL).
   *  Renderizado em âmbar abaixo do sub — sinaliza "leia com ressalva". */
  warn?: string;
  warnTitle?: string;
  accent: "cyan" | "green" | "amber" | "neutral";
  delta?: Delta;
  /** Meta exibida embaixo do card. `metaValor` é a taxa em FRAÇÃO que decide
   *  a cor do marcador. Sem meta, a linha some: KPI de contagem, como total
   *  de leads, não tem meta porque depende da verba, não da operação. */
  meta?: Meta;
  metaValor?: number;
  /** Denominador DESTA taxa, para a guarda de volume. Não é o total do
   *  período: o card de MQL divide por quem respondeu, então um assinante com
   *  11 leads e 6 conversas mostraria "100%" e bateria a meta ideal com 6
   *  casos. A guarda tem que olhar o denominador de cada métrica. */
  metaBase?: number;
};

const FAIXA_STYLE: Record<Faixa, { dot: string; text: string }> = {
  // Sem vermelho de propósito: é tela de cliente, e o número já está do lado.
  // Âmbar chama atenção sem soar como bronca.
  ideal: { dot: "bg-[#10b981]", text: "text-[#10b981]" },
  dentro: {
    dot: "bg-[color:var(--primary)]",
    text: "text-[color:var(--muted-foreground)]",
  },
  abaixo: { dot: "bg-[#f59e0b]", text: "text-[#d97706] dark:text-[#fbbf24]" },
};

const FAIXA_TITULO: Record<Faixa, string> = {
  ideal: "No patamar dos melhores da carteira.",
  dentro: "Dentro do esperado para a carteira.",
  abaixo: "Abaixo da meta mínima no período filtrado.",
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

  // Ninguém respondeu: dividir por zero daria 0%, que o assinante leria como
  // "meu atendimento qualifica zero" quando o certo é "não houve conversa".
  const semInteracao = kpis.interagiram === 0;


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
      meta: METAS.interacao,
      metaValor: kpis.pctInteracao,
      metaBase: kpis.total,
    },
    {
      // O destaque é o MQL ENTRE QUEM RESPONDEU, não sobre o total. Os dois
      // números respondem perguntas diferentes: quem nunca escreveu é assunto
      // de criativo e de canal; quem escreveu e não qualificou é assunto de
      // abordagem. Só o segundo o assinante resolve sozinho, então é ele que
      // fica grande. A taxa sobre o total continua visível logo abaixo.
      label: "MQL entre quem respondeu",
      value: semInteracao ? "—" : pct(kpis.mqlRateInteragiram),
      valuePrevious:
        kpisPrevious && kpisPrevious.interagiram > 0
          ? pct(kpisPrevious.mqlRateInteragiram)
          : undefined,
      sub: semInteracao
        ? "ninguém respondeu no período"
        : `${int(kpis.mqlSimInteragiram)} de ${int(kpis.interagiram)} que responderam`,
      sub2: semInteracao ? undefined : `sobre o total de leads: ${pct(kpis.mqlRate)}`,
      warn: mqlWarn,
      warnTitle: mqlWarn
        ? `${int(semMql)} de ${int(kpis.total)} leads estão sem MQL preenchido (nem "sim" nem "não"). Eles entram no denominador como não-MQL, então a taxa real pode ser maior. Entre os ${int(kpis.total - semMql)} leads classificados, ${pct(kpis.total - semMql > 0 ? kpis.mqlSim / (kpis.total - semMql) : 0)} são MQL.`
        : undefined,
      accent: "green",
      delta: semInteracao ? undefined : deltas?.mqlRateInteragiram,
      meta: METAS.mqlInteragiram,
      metaValor: semInteracao ? undefined : kpis.mqlRateInteragiram,
      metaBase: kpis.interagiram,
    },
    {
      label: GRUPO_LABEL["Agendado+"],
      value: int(kpis.agendadoPlus),
      valuePrevious: kpisPrevious ? int(kpisPrevious.agendadoPlus) : undefined,
      sub: `${pct(kpis.pctAgendamento)} do total`,
      accent: "amber",
      delta: deltas?.agendadoPlus,
      meta: METAS.conversao,
      metaValor: kpis.pctAgendamento,
      metaBase: kpis.total,
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
          {c.sub2 && (
            <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted-foreground)]/70">
              {c.sub2}
            </div>
          )}
          {c.meta &&
            ((c.metaBase ?? 0) < VOLUME_MINIMO ? (
              <div className="mt-1.5 text-[10px] leading-tight text-[color:var(--muted-foreground)]/60">
                poucos leads no período para comparar com a meta
              </div>
            ) : c.metaValor !== undefined ? (
              (() => {
                const faixa = faixaDaMeta(c.metaValor, c.meta);
                const estilo = FAIXA_STYLE[faixa];
                return (
                  <div
                    title={FAIXA_TITULO[faixa]}
                    className={`mt-1.5 flex cursor-help items-center gap-1.5 text-[10px] leading-tight ${estilo.text}`}
                  >
                    <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${estilo.dot}`} />
                    <span className="truncate">{textoDaMeta(c.meta)}</span>
                  </div>
                );
              })()
            ) : null)}
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
