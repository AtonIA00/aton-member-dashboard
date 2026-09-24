import type { ReactNode } from "react";
import type { Deltas, Kpis } from "@/lib/leads";
import type { Delta } from "@/lib/deltas";
import { Detalhe } from "@/components/Detalhe";
import { METAS, VOLUME_MINIMO, type Meta } from "@/lib/metas";

// Faixa de KPIs do funil, no guia de estilo do José (24/09/2026).
//
// Um número por coluna, uma régua por meta, nada além disso. Hierarquia de
// peso: o número grande e leve é o que o olho lê primeiro; rótulo e linha de
// apoio ficam em cinza; a régua mostra onde o número está em relação à meta
// mínima e à ideal. O azul só aparece quando a métrica bateu o ideal.
//
// Decisões do Murillo na adoção:
//  - 4 colunas: Leads, Interação, MQL, Convertido. "Anúncios ativos" e
//    "Campanhas ativas" saíram (sem meta, não entram no strip; a tabela de
//    anúncios logo abaixo já mostra essas contagens).
//  - O último KPI continua "Convertido", nome já em uso no produto, e não
//    "SQL" como no mock.
//  - Leads fica sem régua: meta de volume depende da verba de cada assinante,
//    e esse cadastro não existe. Ads (investimento) fica de fora pelo mesmo
//    motivo, até existir orçamento cadastrado.
//
// Tudo que EXPLICA um número vai para <Detalhe>, visível só com o botão
// "Detalhes" do cabeçalho ligado: variação contra o período anterior, MQL
// sobre o total, aviso de cobertura da classificação, aviso de amostra
// pequena. O número e o absoluto por trás dele ficam sempre à vista.

type Props = {
  kpis: Kpis;
  /** KPIs do período anterior — base do "X no período anterior". */
  kpisPrevious: Kpis | null;
  /** Deltas por KPI. null = "Todo período" ou sem referência. */
  deltas: Deltas | null;
};

function pct(n: number): string {
  return (n * 100).toFixed(1).replace(".", ",") + "%";
}

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

type Coluna = {
  rotulo: string;
  valor: string;
  apoio: string;
  meta?: Meta;
  /** Taxa em FRAÇÃO (0-1). undefined = sem denominador, régua não aparece. */
  metaValor?: number;
  /** Denominador DESTA taxa, para a guarda de volume. Não é o total do
   *  período: o MQL divide por quem respondeu, então 11 leads com 6 conversas
   *  mostrariam "100%" batendo o ideal com 6 casos. */
  metaBase?: number;
  delta?: Delta;
  valorAnterior?: string;
  /** Notas de apoio desta coluna, só com Detalhes ligado. */
  notas?: ReactNode[];
};

export function KpiRow({ kpis, kpisPrevious, deltas }: Props) {
  // Ninguém respondeu: dividir por zero daria 0%, que o assinante leria como
  // "meu atendimento qualifica zero" quando o certo é "não houve conversa".
  const semInteracao = kpis.interagiram === 0;

  // Cobertura da classificação de MQL. Lead sem `mql` preenchido entra no
  // denominador como não-MQL, então a taxa vira PISO. Só vale avisar a partir
  // de 20% sem classificação; abaixo disso a distorção é marginal.
  const pctSemMql = kpis.total > 0 ? kpis.mqlSemClassificacao / kpis.total : 0;

  const colunas: Coluna[] = [
    {
      rotulo: "Leads",
      valor: int(kpis.total),
      apoio: "no período",
      delta: deltas?.total,
      valorAnterior: kpisPrevious ? int(kpisPrevious.total) : undefined,
    },
    {
      rotulo: "Interação",
      valor: pct(kpis.pctInteracao),
      apoio: `${int(kpis.interagiram)} responderam`,
      meta: METAS.interacao,
      metaValor: kpis.total > 0 ? kpis.pctInteracao : undefined,
      metaBase: kpis.total,
      delta: deltas?.pctInteracao,
      valorAnterior: kpisPrevious ? pct(kpisPrevious.pctInteracao) : undefined,
    },
    {
      // O número grande é o MQL ENTRE QUEM RESPONDEU, não sobre o total. Quem
      // nunca escreveu é assunto de criativo e de canal; quem escreveu e não
      // qualificou é assunto de abordagem. Só o segundo o assinante resolve
      // sozinho. O denominador fica explícito na linha de apoio, porque o
      // rótulo é uma palavra só.
      rotulo: "MQL",
      valor: semInteracao ? "—" : pct(kpis.mqlRateInteragiram),
      apoio: semInteracao
        ? "ninguém respondeu no período"
        : `${int(kpis.mqlSimInteragiram)} de ${int(kpis.interagiram)} que responderam`,
      meta: METAS.mqlInteragiram,
      metaValor: semInteracao ? undefined : kpis.mqlRateInteragiram,
      metaBase: kpis.interagiram,
      delta: semInteracao ? undefined : deltas?.mqlRateInteragiram,
      valorAnterior:
        kpisPrevious && kpisPrevious.interagiram > 0
          ? pct(kpisPrevious.mqlRateInteragiram)
          : undefined,
      notas: [
        kpis.total > 0 ? `Sobre o total de leads: ${pct(kpis.mqlRate)}` : null,
        pctSemMql >= 0.2
          ? `${pct(pctSemMql)} dos leads sem classificação de MQL: a taxa é piso e pode subir quando forem classificados.`
          : null,
      ].filter(Boolean) as ReactNode[],
    },
    {
      rotulo: "Convertido",
      valor: pct(kpis.pctAgendamento),
      apoio: `${int(kpis.agendadoPlus)} ${kpis.agendadoPlus === 1 ? "convertido" : "convertidos"}`,
      meta: METAS.conversao,
      metaValor: kpis.total > 0 ? kpis.pctAgendamento : undefined,
      metaBase: kpis.total,
      delta: deltas?.pctAgendamento,
      valorAnterior: kpisPrevious ? pct(kpisPrevious.pctAgendamento) : undefined,
    },
  ];

  return (
    <section
      aria-label="Indicadores principais"
      className="kpi-strip rounded-[24px] border border-[color:var(--border)] bg-[color:var(--card)] py-6"
    >
      <div className="grid grid-cols-2 gap-y-8 lg:grid-cols-4 lg:gap-y-0 lg:[&>*+*]:border-l lg:[&>*+*]:border-[color:var(--kpi-divisor)]">
        {colunas.map((c) => (
          <ColunaKpi key={c.rotulo} c={c} />
        ))}
      </div>
    </section>
  );
}

function ColunaKpi({ c }: { c: Coluna }) {
  const temRegua = c.meta && c.metaValor !== undefined && (c.metaBase ?? 0) >= VOLUME_MINIMO;
  const amostraPequena = c.meta && c.metaValor !== undefined && (c.metaBase ?? 0) < VOLUME_MINIMO;

  return (
    <div className="flex min-h-[155px] flex-col px-[22px] font-[family-name:var(--font-urbanist)]">
      <div className="text-[14px] font-medium leading-tight text-[color:var(--kpi-secundario)]">
        {c.rotulo}
      </div>

      {/* Número nunca em negrito: o peso leve em tamanho grande é o traço do estilo. */}
      <div
        className="mt-3 font-normal leading-none tracking-[-0.035em] tabular-nums text-[color:var(--kpi-numero)]"
        style={{ fontSize: "clamp(34px, 3.2vw, 52px)" }}
      >
        {c.valor}
      </div>

      <div className="mt-1.5 text-[13px] leading-snug text-[color:var(--kpi-secundario)]">
        {c.apoio}
      </div>

      {c.delta && c.valorAnterior !== undefined && (
        <Detalhe className="mt-2 text-[12px] leading-snug text-[color:var(--kpi-secundario)]">
          {c.delta.formatted}
          {c.delta.direction !== "new" && ` · ${c.valorAnterior} no período anterior`}
        </Detalhe>
      )}
      {c.notas?.map((n, i) => (
        <Detalhe key={i} className="mt-1.5 text-[12px] leading-snug text-[color:var(--kpi-secundario)]">
          {n}
        </Detalhe>
      ))}
      {amostraPequena && (
        <Detalhe className="mt-1.5 text-[12px] leading-snug text-[color:var(--kpi-secundario)]">
          Poucos casos no período para comparar com a meta.
        </Detalhe>
      )}

      {/* A régua fica sempre na base da coluna, alinhada com as vizinhas. */}
      {temRegua && (
        <div className="mt-auto pt-4">
          <Regua meta={c.meta!} valor01={c.metaValor!} rotuloValor={c.valor} />
        </div>
      )}
    </div>
  );
}

function Regua({ meta, valor01, rotuloValor }: { meta: Meta; valor01: number; rotuloValor: string }) {
  const v = valor01 * 100;
  const pos = (x: number) => Math.min(100, Math.max(0, (x / meta.teto) * 100));
  const bateuIdeal = v >= meta.ideal;

  return (
    <div
      role="img"
      aria-label={`${rotuloValor}. Meta mínima ${meta.minima}%, ideal ${meta.ideal}%.`}
    >
      <div className="relative h-[10px]">
        {/* trilho */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[color:var(--kpi-trilho)]" />
        {/* preenchimento */}
        <div
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full"
          style={{
            width: `${pos(v)}%`,
            background: bateuIdeal ? "var(--kpi-ideal-fill)" : "var(--kpi-abaixo-fill)",
          }}
        />
        {/* marcas de mínimo e de ideal */}
        <span
          className="absolute top-0 h-[10px] w-[2px] rounded-[2px] bg-[color:var(--kpi-marca-min)]"
          style={{ left: `calc(${pos(meta.minima)}% - 1px)` }}
        />
        <span
          className="absolute top-0 h-[10px] w-[2px] rounded-[2px] bg-[color:var(--kpi-marca-ideal)]"
          style={{ left: `calc(${pos(meta.ideal)}% - 1px)` }}
        />
      </div>
      <div className="mt-2 flex justify-between gap-2 whitespace-nowrap font-[family-name:var(--font-space-grotesk)] text-[12px] text-[color:var(--kpi-secundario)]">
        <span>Mín {meta.minima}%</span>
        <span>Ideal {meta.ideal}%</span>
      </div>
    </div>
  );
}
