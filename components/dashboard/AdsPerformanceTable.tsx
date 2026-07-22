"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdsPerfRow, Kpis } from "@/lib/leads";
import type { Delta } from "@/lib/deltas";
import type { MetaAdsForTable } from "@/lib/meta-ads";

type HmacParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
};

type Props = {
  rows: AdsPerfRow[];
  /** Insights do Meta Ads (null = flag off / sem conta vinculada / erro). */
  metaAds: MetaAdsForTable | null;
  /** KPIs do recorte — base do resumo custo × desfecho. */
  kpis: Kpis;
  /** Filtros ativos → resumo de custo é ocultado (spend é da conta inteira;
   *  comparar com KPIs filtrados distorceria os R$/lead). */
  filtersActive: boolean;
  /** Params assinados do iframe — auth do /api/ads/preview (modal do criativo). */
  hmac: HmacParams;
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

export function AdsPerformanceTable({ rows, metaAds, kpis, filtersActive, hmac }: Props) {
  const [sortCol, setSortCol] = useState<SortCol>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Lookup por anúncio ([spend, ctr, cpc, cpm, adName, thumbUrl, campaignName]).
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
                {metaAds ? "Anúncio" : "ID Anúncio"}
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
                <td className="max-w-[280px] px-4 py-2 text-xs text-[color:var(--foreground)]">
                  {r.isUnknownId ? (
                    <span className="font-mono italic text-[color:var(--muted-foreground)]/80">
                      Sem ID
                    </span>
                  ) : (
                    <AdIdentity idAnuncio={r.idAnuncio} meta={adOf(r)} hmac={hmac} />
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
type AdTuple = MetaAdsForTable["ads"][string];

// ── Identidade do anúncio: thumb do criativo + nome + ID ────────────────────
// Reconhecimento em 3 camadas (padrão Ads Manager): imagem → nome → ID.
// Hover no thumb → preview rápido (position:fixed escapa do clipping do
// overflow). CLIQUE no thumb → modal com o anúncio REAL via Ad Preview API
// (vídeo tocável, carrossel navegável). Badge no thumb indica o formato.
// Sem identidade no Meta → só o ID, como antes.
function AdIdentity({
  idAnuncio,
  meta,
  hmac,
}: {
  idAnuncio: string;
  meta: AdTuple | undefined;
  hmac: HmacParams;
}) {
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const name = meta?.[4] ?? null;
  const thumb = meta?.[5] ?? null;
  const campaign = meta?.[6] ?? null;
  const format = meta?.[7] ?? "image";

  if (!name && !thumb) {
    return <span className="font-mono">{idAnuncio}</span>;
  }

  return (
    <div className="flex items-center gap-2.5">
      {thumb ? (
        <button
          type="button"
          title={format === "video" ? "Reproduzir o anúncio" : "Ver o anúncio como publicado"}
          className="relative shrink-0 cursor-pointer rounded-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[color:var(--primary)]/50"
          onClick={() => {
            setPreview(null);
            setModalOpen(true);
          }}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPreview({ x: r.right + 12, y: r.top - 8 });
          }}
          onMouseLeave={() => setPreview(null)}
        >
          <img
            src={thumb}
            alt={name ?? "Criativo do anúncio"}
            referrerPolicy="no-referrer"
            className="h-10 w-10 rounded-lg object-cover ring-1 ring-[color:var(--border)]"
          />
          {format === "video" && (
            <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/25">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white/90 shadow">
                <svg width="8" height="8" viewBox="0 0 10 10" className="translate-x-[0.5px]">
                  <path d="M2 1.2v7.6c0 .5.55.8.98.55l6.06-3.8a.65.65 0 0 0 0-1.1L2.98.65A.65.65 0 0 0 2 1.2Z" fill="#111" />
                </svg>
              </span>
            </span>
          )}
          {format === "carousel" && (
            <span className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/55 text-white shadow">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <rect x="3" y="7" width="13" height="13" rx="2" />
                <path d="M8 3h11a2 2 0 0 1 2 2v11" />
              </svg>
            </span>
          )}
        </button>
      ) : (
        <div
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--muted)]/60 ring-1 ring-[color:var(--border)] text-[color:var(--muted-foreground)]/50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-4.5-4.5L7 20" />
          </svg>
        </div>
      )}
      <div className="min-w-0">
        <div
          className="max-w-[200px] truncate text-xs font-semibold text-[color:var(--foreground)]"
          title={campaign && name ? `${name} — ${campaign}` : (name ?? undefined)}
        >
          {name ?? idAnuncio}
        </div>
        <div className="font-mono text-[10px] leading-tight text-[color:var(--muted-foreground)]/70">
          {idAnuncio}
        </div>
      </div>
      {preview && thumb && (
        <div
          className="pointer-events-none fixed z-50 w-60 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-2xl"
          style={{
            left: Math.min(preview.x, window.innerWidth - 260),
            top: Math.max(8, Math.min(preview.y, window.innerHeight - 316)),
          }}
        >
          <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-60 w-60 object-cover" />
          <div className="px-2.5 py-2">
            <div className="truncate text-[11px] font-bold text-[color:var(--foreground)]">{name}</div>
            {campaign && (
              <div className="truncate text-[10px] text-[color:var(--muted-foreground)]">{campaign}</div>
            )}
            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--primary)]">
              {format === "video" ? "▶ clique para reproduzir" : "clique para ver o anúncio"}
            </div>
          </div>
        </div>
      )}
      {modalOpen && (
        <AdPreviewModal
          adId={idAnuncio}
          name={name}
          campaign={campaign}
          hmac={hmac}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

// ── Modal com o anúncio real (Ad Preview API) ───────────────────────────────
// O iframe da Meta renderiza o anúncio como publicado: vídeo com play,
// carrossel com setas. Fecha por backdrop, ✕ ou Esc.
function AdPreviewModal({
  adId,
  name,
  campaign,
  hmac,
  onClose,
}: {
  adId: string;
  name: string | null;
  campaign: string | null;
  hmac: HmacParams;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ src: string | null; error: boolean }>({
    src: null,
    error: false,
  });

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({
      ad_id: adId,
      workspace_id: hmac.workspace_id,
      user_id: hmac.user_id,
      timestamp: hmac.timestamp,
      signature: hmac.signature,
    });
    fetch(`/api/ads/preview?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { src?: string }) => {
        if (alive) setState({ src: j.src ?? null, error: !j.src });
      })
      .catch(() => {
        if (alive) setState({ src: null, error: true });
      });
    return () => {
      alive = false;
    };
  }, [adId, hmac]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[400px] flex-col overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[color:var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-[color:var(--foreground)]">
              {name ?? adId}
            </div>
            <div className="truncate text-[11px] text-[color:var(--muted-foreground)]">
              {campaign ?? `ID ${adId}`} · como publicado no Meta
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-1.5 text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-[420px] flex-1 overflow-auto bg-[#f0f2f5] dark:bg-[#18191a]">
          {state.src ? (
            <iframe
              src={state.src}
              title={name ?? "Preview do anúncio"}
              className="h-[600px] w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          ) : state.error ? (
            <div className="flex h-[420px] flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="text-2xl">🚫</span>
              <span className="text-xs font-semibold text-[color:var(--foreground)]">
                Preview indisponível
              </span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">
                O Meta não gerou o preview deste anúncio (pode ter sido apagado ou estar em revisão).
              </span>
            </div>
          ) : (
            <div className="flex h-[420px] items-center justify-center">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-[color:var(--border)] border-t-[color:var(--primary)]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaCells({
  ad,
  row,
  currency,
}: {
  ad: AdTuple | undefined;
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
