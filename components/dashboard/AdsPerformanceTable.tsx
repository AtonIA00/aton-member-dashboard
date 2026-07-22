"use client";

import { useMemo, useState } from "react";
import type { AdsPerfRow, Kpis } from "@/lib/leads";
import type { Delta } from "@/lib/deltas";
import type { MetaAdsForTable } from "@/lib/meta-ads";

type Props = {
  rows: AdsPerfRow[];
  /** Insights do Meta Ads (null = flag off / sem conta vinculada / erro). */
  metaAds: MetaAdsForTable | null;
  /** KPIs do recorte — base do resumo custo × desfecho. */
  kpis: Kpis;
  /** Filtros ativos → resumo de custo é ocultado (spend é da conta inteira;
   *  comparar com KPIs filtrados distorceria os R$/lead). */
  filtersActive: boolean;
};

type SortCol =
  | "rank"
  | "id"
  | "agendados"
  | "pctAgend"
  | "pctMql"
  | "pctInteracao"
  | "total"
  | "spend";
type SortDir = "asc" | "desc";

function pct(n: number): string {
  return (n * 100).toFixed(1).replace(".", ",") + "%";
}

function fmtMoney(v: number, currency = "BRL"): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** R$ por desfecho — "—" quando não há desfecho (divisão por zero). */
function fmtCostPer(spend: number, count: number, currency: string): string {
  if (count <= 0) return "—";
  return fmtMoney(spend / count, currency);
}

// Heat pills com contraste em ambos os temas. Light usa tons -700 sobre bg
// -100 (claro); dark usa tons -300/-400 sobre bg /15 (suave). Token Aton
// pra "verde" = emerald (#10b981), "amarelo" = amber, "laranja" = orange,
// "vermelho" = destructive (red).
//
// hC(v, [t0, t1, t2]) → t2+: verde, t1+: amarelo, t0+: laranja, abaixo: vermelho.
function heatClass(v: number, thresholds: [number, number, number]): string {
  const v100 = v * 100;
  if (v100 >= thresholds[2])
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  if (v100 >= thresholds[1])
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (v100 >= thresholds[0])
    return "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300";
  return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
}

// Faixas de cor ancoradas nos QUARTIS reais do portfólio Aton, não em metas
// abstratas. Cor = posição do assinante vs. a carteira:
//   🔴 pior 25% · 🟠 abaixo da mediana · 🟡 acima da mediana · 🟢 top 25%
// Calibrado em 2026-07-22 sobre 31 workspaces com ≥50 leads (percentis p25/
// p50/p75): interação 50/66/74 · MQL 11/20/30 · conversão 4/9/14. Recalibrar
// semestralmente conforme a carteira evolui. Os cortes antigos ([_,_,30]/[_,_,
// 50]/[_,_,80]) eram inatingíveis — quase ninguém ficava verde.
const PCT_AGEND_THRESHOLDS: [number, number, number] = [4, 9, 15];
const PCT_MQL_THRESHOLDS: [number, number, number] = [10, 20, 30];
const PCT_INTERACAO_THRESHOLDS: [number, number, number] = [50, 65, 75];

export function AdsPerformanceTable({ rows, metaAds, kpis, filtersActive }: Props) {
  const [sortCol, setSortCol] = useState<SortCol>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Lookup de insight por anúncio ([spend, ctr, cpc, cpm, metaLeads, metaCpl]).
  const adOf = (r: AdsPerfRow) => (metaAds ? metaAds.ads[r.idAnuncio] : undefined);

  const sorted = useMemo(() => {
    // Sempre manter "Sem ID" (isUnknownId) no topo, conforme spec.
    const unknown = rows.filter((r) => r.isUnknownId);
    const known = [...rows.filter((r) => !r.isUnknownId)];
    known.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortCol) {
        case "rank":
          return (a.rank - b.rank) * dir;
        case "id":
          return a.idAnuncio.localeCompare(b.idAnuncio) * dir;
        case "agendados":
          return (a.agendados - b.agendados) * dir;
        case "pctAgend":
          return (a.pctAgendamento - b.pctAgendamento) * dir;
        case "pctMql":
          return (a.pctMql - b.pctMql) * dir;
        case "pctInteracao":
          return (a.pctInteracao - b.pctInteracao) * dir;
        case "spend": {
          const sa = metaAds?.ads[a.idAnuncio]?.[0] ?? -1;
          const sb = metaAds?.ads[b.idAnuncio]?.[0] ?? -1;
          return (sa - sb) * dir;
        }
        case "total":
        default:
          return (a.total - b.total) * dir;
      }
    });
    return [...unknown, ...known];
  }, [rows, sortCol, sortDir, metaAds]);

  function toggle(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "id" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-6 text-center text-sm text-[color:var(--muted-foreground)] backdrop-blur">
        Nenhum anúncio com leads no período selecionado.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-6 py-4">
        <span
          aria-hidden
          className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]"
        />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Performance por Anúncio
        </h2>
        <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)]/70">
          {rows.length} {rows.length === 1 ? "anúncio" : "anúncios"}
          {metaAds && (
            <span className="ml-2 rounded-full bg-[color:var(--primary)]/10 px-2 py-0.5 text-[10px] font-bold text-[color:var(--primary)]">
              + Meta Ads
            </span>
          )}
        </span>
      </div>

      {/* Resumo custo × desfecho (investimento da conta ÷ desfechos da base).
          Oculto com filtros ativos: o spend é da conta INTEIRA no período —
          dividir por KPIs filtrados inflaria os custos artificialmente. */}
      {metaAds && !filtersActive && (
        <CostSummaryStrip metaAds={metaAds} kpis={kpis} />
      )}

      <div className="max-h-[460px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[color:var(--card)]">
            <tr>
              <Th col="rank" sortCol={sortCol} sortDir={sortDir} onClick={toggle}>
                #
              </Th>
              <Th col="id" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="left">
                ID Anúncio
              </Th>
              <Th col="agendados" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                Agendados
              </Th>
              <Th col="pctAgend" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                % Agendamento
              </Th>
              <Th col="pctMql" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                % MQL
              </Th>
              <Th col="pctInteracao" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                % Interação
              </Th>
              {metaAds && (
                <>
                  <Th col="spend" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                    Invest.
                  </Th>
                  <ThPlain align="right">CTR</ThPlain>
                  <ThPlain align="right" title="Investimento ÷ leads desta base">
                    CPL
                  </ThPlain>
                  <ThPlain align="right" title="Investimento ÷ MQLs">
                    R$/MQL
                  </ThPlain>
                  <ThPlain align="right" title="Investimento ÷ convertidos">
                    R$/Conv.
                  </ThPlain>
                </>
              )}
              <Th col="total" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                Total
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={`${r.idAnuncio}-${i}`}
                className="border-t border-[color:var(--border)]/60 transition-colors hover:bg-[color:var(--primary)]/5"
              >
                <td className="px-4 py-3 text-xs text-[color:var(--muted-foreground)]">
                  {r.isUnknownId ? "—" : r.rank}
                </td>
                <td className="max-w-[260px] truncate px-4 py-3 font-mono text-xs text-[color:var(--foreground)]">
                  {r.isUnknownId ? (
                    <span className="italic text-[color:var(--muted-foreground)]/80">
                      Sem ID
                    </span>
                  ) : (
                    r.idAnuncio
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-[color:var(--foreground)]">
                  {r.agendados.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-3 text-right">
                  <HeatPill v={r.pctAgendamento} thresholds={PCT_AGEND_THRESHOLDS} />
                  {r.pctAgendamentoDelta && <DeltaLine delta={r.pctAgendamentoDelta} />}
                </td>
                <td className="px-4 py-3 text-right">
                  <HeatPill v={r.pctMql} thresholds={PCT_MQL_THRESHOLDS} />
                  {r.pctMqlDelta && <DeltaLine delta={r.pctMqlDelta} />}
                </td>
                <td className="px-4 py-3 text-right">
                  <HeatPill v={r.pctInteracao} thresholds={PCT_INTERACAO_THRESHOLDS} />
                  {r.pctInteracaoDelta && <DeltaLine delta={r.pctInteracaoDelta} />}
                </td>
                {metaAds && (
                  <MetaCells
                    ad={adOf(r)}
                    row={r}
                    currency={metaAds.currency}
                  />
                )}
                <td className="px-4 py-3 text-right font-bold tabular-nums text-[color:var(--foreground)]">
                  <div>{r.total.toLocaleString("pt-BR")}</div>
                  {r.totalDelta && <DeltaLine delta={r.totalDelta} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {metaAds && (
        <div className="border-t border-[color:var(--border)] px-6 py-2 text-[10px] leading-relaxed text-[color:var(--muted-foreground)]/70">
          Investimento, CTR e CPC via <strong className="font-semibold">Meta Ads</strong> (conta vinculada, mesmo período do filtro).
          Contagem de leads: <strong className="font-semibold">sempre a desta base Aton</strong> (fonte da verdade) — CPL, R$/MQL e R$/Conv. são investimento ÷ leads reais.
          Anúncios sem investimento no período aparecem com “—”.
        </div>
      )}
    </div>
  );
}

// ── Resumo custo × desfecho (topo da seção) ─────────────────────────────────
function CostSummaryStrip({ metaAds, kpis }: { metaAds: MetaAdsForTable; kpis: Kpis }) {
  const c = metaAds.currency;
  const items: { label: string; value: string; sub?: string; accent?: boolean }[] = [
    {
      label: "Investimento",
      value: fmtMoney(metaAds.totalSpend, c),
      sub: "Meta Ads no período",
      accent: true,
    },
    {
      label: "CPL real",
      value: fmtCostPer(metaAds.totalSpend, kpis.total, c),
      sub: `${kpis.total.toLocaleString("pt-BR")} leads na base`,
    },
    {
      label: "Custo por MQL",
      value: fmtCostPer(metaAds.totalSpend, kpis.mqlSim, c),
      sub: `${kpis.mqlSim.toLocaleString("pt-BR")} qualificados`,
    },
    {
      label: "Custo por convertido",
      value: fmtCostPer(metaAds.totalSpend, kpis.agendadoPlus, c),
      sub: `${kpis.agendadoPlus.toLocaleString("pt-BR")} convertidos`,
    },
    {
      label: "CTR médio",
      value: `${metaAds.avgCtr.toFixed(2).replace(".", ",")}%`,
      sub: `CPC ${fmtMoney(metaAds.avgCpc, c)}`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border-b border-[color:var(--border)] bg-[color:var(--border)]/40 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="bg-[color:var(--card)] px-5 py-3.5">
          <div
            className={
              "font-[family-name:var(--font-montserrat)] text-lg font-bold leading-none " +
              (it.accent ? "text-[color:var(--primary)]" : "text-[color:var(--foreground)]")
            }
          >
            {it.value}
          </div>
          <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            {it.label}
          </div>
          {it.sub && (
            <div className="mt-0.5 text-[10px] text-[color:var(--muted-foreground)]/70">{it.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Células Meta por linha ([spend, ctr, cpc, cpm, metaLeads, metaCpl]) ──────
function MetaCells({
  ad,
  row,
  currency,
}: {
  ad: [number, number, number, number] | undefined;
  row: AdsPerfRow;
  currency: string;
}) {
  if (!ad) {
    return (
      <>
        {[0, 1, 2, 3, 4].map((i) => (
          <td key={i} className="px-4 py-3 text-right text-xs text-[color:var(--muted-foreground)]/50">
            —
          </td>
        ))}
      </>
    );
  }
  const [spend, ctr, cpc, cpm] = ad;
  // Só métricas de MÍDIA no tooltip — contagem de leads é SEMPRE a da base
  // Aton (decisão: leads do Meta são frequentemente errôneos, não exibir).
  const tip = `Meta: CPC ${fmtMoney(cpc, currency)} · CPM ${fmtMoney(cpm, currency)}`;
  return (
    <>
      <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold tabular-nums text-[color:var(--foreground)]" title={tip}>
        {fmtMoney(spend, currency)}
      </td>
      <td className="px-4 py-3 text-right text-xs tabular-nums text-[color:var(--muted-foreground)]">
        {ctr.toFixed(2).replace(".", ",")}%
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums text-[color:var(--foreground)]/90">
        {fmtCostPer(spend, row.total, currency)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums text-[color:var(--foreground)]/90">
        {fmtCostPer(spend, row.mqlSim, currency)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold tabular-nums text-[color:var(--foreground)]">
        {fmtCostPer(spend, row.agendados, currency)}
      </td>
    </>
  );
}

function ThPlain({
  align,
  title,
  children,
}: {
  align?: "left" | "right";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      scope="col"
      title={title}
      className={
        "whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)] " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function Th({
  col,
  sortCol,
  sortDir,
  onClick,
  align,
  children,
}: {
  col: SortCol;
  sortCol: SortCol;
  sortDir: SortDir;
  onClick: (c: SortCol) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = col === sortCol;
  const dir = active ? (sortDir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      scope="col"
      className={
        "px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)] " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      <button
        type="button"
        onClick={() => onClick(col)}
        className={
          "inline-flex items-center gap-1 hover:text-[color:var(--primary)] " +
          (active ? "text-[color:var(--primary)]" : "")
        }
      >
        {children} <span aria-hidden>{dir}</span>
      </button>
    </th>
  );
}

// Delta compacto vs. período anterior — mesma régua/cores dos KPIs. Usado
// no Total (count) e nas colunas de % (pontos percentuais). Só aparece
// quando há período anterior (filtro de data).
function DeltaLine({ delta }: { delta: Delta }) {
  const cls =
    delta.classification === "positive"
      ? "text-[#10b981]"
      : delta.classification === "negative"
        ? "text-[color:var(--destructive)]"
        : "text-[color:var(--muted-foreground)]";
  const label = delta.direction === "new" ? "novo" : delta.formatted;
  return (
    <span
      className={"mt-0.5 block text-[10px] font-medium " + cls}
      title={`Atual: ${delta.value} · Anterior: ${delta.valuePrevious}`}
    >
      {label}
    </span>
  );
}

function HeatPill({
  v,
  thresholds,
}: {
  v: number;
  thresholds: [number, number, number];
}) {
  return (
    <span
      className={
        "inline-block min-w-[3.25rem] rounded px-2 py-1 text-center text-[11px] font-bold tabular-nums " +
        heatClass(v, thresholds)
      }
    >
      {(v * 100).toFixed(1).replace(".", ",")}
    </span>
  );
}
