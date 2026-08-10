"use client";

import { useMemo, useState } from "react";
// Importa do meta-ads-kpi (client-safe), NÃO do meta-ads (server-only):
// componente cliente que importa valor do módulo com o token quebra o build.
import {
  adRow,
  bodyThresholds,
  duracaoStatus,
  VIDEO_DURACAO,
  VIDEO_KPI,
  VIDEO_MIN_PLAYS,
  type DuracaoStatus,
  type MetaAdsForTable,
  type MetaAdRow,
} from "@/lib/meta-ads-kpi";

// Retenção de vídeo — metodologia do Richard (especialista em métricas de
// vídeo), conversa de 2026-08-05. Lê como funil, na ordem em que a pessoa
// consome o criativo:
//
//   1º frame (play rate) → passou do hook (3s) → viu a mensagem (75%) → clicou
//
// Seção SEPARADA em vez de colunas novas na Performance por Anúncio: aquela
// tabela já rola horizontalmente (reclamação do Murillo) e estes KPIs só
// existem pra criativo de VÍDEO — numa tabela com imagem/carrossel seriam
// 4 colunas de "—".

type Props = {
  metaAds: MetaAdsForTable | null;
  /** Nº de leads da base por ad_id — cruza retenção com resultado real. */
  leadsByAdId: Record<string, number>;
};

type Row = MetaAdRow & {
  adId: string;
  retHook: number;
  retBody: number;
  /** Régua do body ajustada pela duração deste vídeo. */
  bodyT: [number, number, number];
  durStatus: DuracaoStatus | null;
  lowVolume: boolean;
  leads: number;
};

function pct1(v: number): string {
  return v.toFixed(1).replace(".", ",") + "%";
}

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

// Heat com a MESMA paleta das pills da Performance por Anúncio.
function heat(v: number, [t0, t1, t2]: [number, number, number]): string {
  if (v >= t2) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  if (v >= t1) return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (v >= t0) return "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300";
  return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
}

export function VideoRetentionTable({ metaAds, leadsByAdId }: Props) {
  const [sortCol, setSortCol] = useState<"plays" | "retHook" | "retBody" | "leads">("plays");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo<Row[]>(() => {
    if (!metaAds) return [];
    const out: Row[] = [];
    for (const [adId, tuple] of Object.entries(metaAds.ads)) {
      const r = adRow(tuple);
      // Só vídeo, e só quem teve reprodução (sem play não há retenção).
      if (r.format !== "video" || r.plays <= 0) continue;
      out.push({
        ...r,
        adId,
        retHook: (r.views3s / r.plays) * 100,
        retBody: (r.p75 / r.plays) * 100,
        bodyT: bodyThresholds(r.duracaoSeg),
        durStatus: duracaoStatus(r.duracaoSeg),
        lowVolume: r.plays < VIDEO_MIN_PLAYS,
        leads: leadsByAdId[adId] ?? 0,
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return out.sort((a, b) => (a[sortCol] - b[sortCol]) * dir);
  }, [metaAds, leadsByAdId, sortCol, sortDir]);

  if (!metaAds || rows.length === 0) return null;

  // Agregado da conta: soma as bases e divide (não média de taxas, que daria
  // peso igual a um vídeo de 200 e outro de 200 mil reproduções).
  const tot = rows.reduce(
    (a, r) => ({
      impressions: a.impressions + r.impressions,
      plays: a.plays + r.plays,
      views3s: a.views3s + r.views3s,
      p75: a.p75 + r.p75,
    }),
    { impressions: 0, plays: 0, views3s: 0, p75: 0 },
  );
  const aggHook = tot.plays > 0 ? (tot.views3s / tot.plays) * 100 : 0;
  const aggBody = tot.plays > 0 ? (tot.p75 / tot.plays) * 100 : 0;
  const totLeads = rows.reduce((s, r) => s + r.leads, 0);

  const toggle = (c: typeof sortCol) => {
    if (c === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(c);
      setSortDir("desc");
    }
  };

  const Th = ({
    col,
    title,
    children,
  }: {
    col?: typeof sortCol;
    title?: string;
    children: React.ReactNode;
  }) => (
    <th
      scope="col"
      title={title}
      className="whitespace-nowrap px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]"
    >
      {col ? (
        <button
          type="button"
          onClick={() => toggle(col)}
          className={
            "inline-flex items-center gap-1 hover:text-[color:var(--primary)] " +
            (col === sortCol ? "text-[color:var(--primary)]" : "")
          }
        >
          {children}
          {col === sortCol && <span>{sortDir === "asc" ? "↑" : "↓"}</span>}
        </button>
      ) : (
        children
      )}
    </th>
  );

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-6 py-4">
        <span aria-hidden className="h-4 w-1 rounded-full bg-[color:var(--primary)]" />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Retenção de Vídeo
        </h2>
        <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)]/70">
          {rows.length} {rows.length === 1 ? "criativo" : "criativos"} em vídeo
        </span>
      </div>

      {/* Funil da conta: base → onde a audiência cai → desfecho real. */}
      <div className="grid grid-cols-2 gap-px border-b border-[color:var(--border)] bg-[color:var(--border)]/40 sm:grid-cols-4">
        <FunnelCard
          label="Reproduções"
          value={int(tot.plays)}
          sub="base das taxas"
          neutral
        />
        <FunnelCard
          label="Passaram do hook (3s)"
          value={pct1(aggHook)}
          sub={`${int(tot.views3s)} de ${int(tot.plays)}`}
          meta={VIDEO_KPI.retHook.meta}
          metaTip="Quartil superior da carteira Aton (p75). A mediana é 26% — acima dela já fica amarelo."
          ok={aggHook >= VIDEO_KPI.retHook.t[2]}
        />
        <FunnelCard
          label="Viram a mensagem (75%)"
          value={pct1(aggBody)}
          sub={`${int(tot.p75)} de ${int(tot.plays)}`}
          meta={VIDEO_KPI.retBody.meta}
          metaTip="Quartil superior da carteira para vídeo de 35-50s. Por criativo a régua é AJUSTADA pela duração: verde em 5,5% (até 35s), 4,9% (35-50s) ou 3,4% (50s+) — alcançar 75% de um vídeo longo é mecanicamente mais difícil."
          ok={aggBody >= VIDEO_KPI.retBody.t[2]}
        />
        <FunnelCard
          label="Leads gerados"
          value={int(totLeads)}
          sub="desfecho na base Aton"
          neutral
        />
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[color:var(--card)]">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]"
              >
                Criativo
              </th>
              <Th title={`Duração do vídeo. Faixa recomendada ${VIDEO_DURACAO.idealMin}-${VIDEO_DURACAO.idealMax}s, derivada do desfecho real da carteira: abaixo de 30s o CPL mediano é R$ 262 e acima de 60s a qualificação despenca. "—" = a Meta bloqueia a duração deste vídeo (página não compartilhada).`}>
                Duração
              </Th>
              <Th col="plays" title="Reproduções do vídeo (base das taxas de retenção)">
                Reprod.
              </Th>
              <Th
                col="retHook"
                title="Reproduções de 3s ÷ reproduções — quem passou do hook (0-5s). Meta: 40-50% no mercado imobiliário (mediana da carteira Aton: 26%)."
              >
                Ret. hook
              </Th>
              <Th
                col="retBody"
                title="Reproduções de 75% ÷ reproduções — quem consumiu a mensagem de venda. Meta: acima de 2%."
              >
                Ret. body
              </Th>
              <Th col="leads" title="Leads desta base atribuídos ao anúncio — o desfecho real da retenção">
                Leads
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.adId}
                className="border-t border-[color:var(--border)]/60 transition-colors hover:bg-[color:var(--primary)]/5"
              >
                <td className="max-w-[260px] px-4 py-2">
                  <div className="flex items-center gap-2.5">
                    {r.thumbnailUrl ? (
                      <img
                        src={r.thumbnailUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-[color:var(--border)]"
                      />
                    ) : (
                      <div className="h-9 w-9 shrink-0 rounded-lg bg-[color:var(--muted)]/60 ring-1 ring-[color:var(--border)]" />
                    )}
                    <div className="min-w-0">
                      <div
                        className="max-w-[190px] truncate text-xs font-semibold text-[color:var(--foreground)]"
                        title={r.campaignName ? `${r.adName} — ${r.campaignName}` : (r.adName ?? "")}
                      >
                        {r.adName ?? r.adId}
                      </div>
                      <div className="font-mono text-[10px] leading-tight text-[color:var(--muted-foreground)]/70">
                        {r.adId}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  <DuracaoCell seg={r.duracaoSeg} status={r.durStatus} />
                </td>
                <td className="px-4 py-2 text-right text-xs tabular-nums text-[color:var(--foreground)]">
                  {int(r.plays)}
                  {r.lowVolume && (
                    <div
                      className="text-[9px] font-semibold uppercase leading-tight text-[color:var(--muted-foreground)]/70"
                      title={`Menos de ${VIDEO_MIN_PLAYS} reproduções — as taxas abaixo são estatisticamente frágeis, por isso sem cor.`}
                    >
                      amostra baixa
                    </div>
                  )}
                </td>
                <Rate v={r.retHook} t={VIDEO_KPI.retHook.t} raw={r.lowVolume} />
                <Rate
                  v={r.retBody}
                  t={r.bodyT}
                  raw={r.lowVolume}
                  title={
                    r.duracaoSeg != null
                      ? `Régua ajustada para vídeo de ${Math.round(r.duracaoSeg)}s: verde ≥ ${r.bodyT[2].toFixed(1).replace(".", ",")}%. Chegar a 75% de um vídeo longo é mecanicamente mais difícil.`
                      : "Duração desconhecida — usando a régua base (35-50s)."
                  }
                />
                <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-[color:var(--foreground)]">
                  {r.leads > 0 ? int(r.leads) : <span className="text-[color:var(--muted-foreground)]/50">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[color:var(--border)] px-6 py-2 text-[10px] leading-relaxed text-[color:var(--muted-foreground)]/70">
        Leia como funil: <strong className="font-semibold">reproduções</strong> →{" "}
        <strong className="font-semibold">passou do hook</strong> (3s) →{" "}
        <strong className="font-semibold">viu a mensagem</strong> (75%) →{" "}
        <strong className="font-semibold">leads</strong>. A queda entre duas etapas diz onde o
        criativo perde a audiência: hook fraco, corpo longo ou oferta.
        Cores: 🟢 quartil superior da carteira Aton · 🟡 acima da mediana · 🟠 acima do 1º quartil · 🔴 abaixo.
        <br />
        <strong className="font-semibold">Duração recomendada: {VIDEO_DURACAO.idealMin}–{VIDEO_DURACAO.idealMax}s.</strong>{" "}
        Medido na carteira (90 dias): abaixo de 30s o CPL mediano é R$ 262 contra R$ 61 na faixa de
        30–40s; acima de 60s a qualificação cai para 0,018 MQL por mil reproduções (a faixa de
        40–50s faz 0,086). A régua de <em>ret. body</em> é ajustada pela duração de cada vídeo —
        alcançar 75% de um vídeo longo é mecanicamente mais difícil.
        Métricas de vídeo via Meta Ads; leads da base Aton.
      </div>
    </div>
  );
}

/** Duração + tarja quando fora da faixa recomendada (30-50s). */
function DuracaoCell({ seg, status }: { seg: number | null; status: DuracaoStatus | null }) {
  if (seg == null) {
    return (
      <span
        className="text-xs text-[color:var(--muted-foreground)]/50"
        title="A Meta não libera a duração deste vídeo (a página dona não foi compartilhada com a Aton). A régua do body cai no padrão."
      >
        —
      </span>
    );
  }
  const s = Math.round(seg);
  const cfg: Record<DuracaoStatus, { cls: string; tag: string | null; tip: string }> = {
    curto: {
      cls: "text-[#d97706] dark:text-[#fbbf24]",
      tag: "curto",
      tip: `Abaixo de ${VIDEO_DURACAO.idealMin}s. Na carteira Aton essa é a PIOR faixa: CPL mediano de R$ 262 contra R$ 61 na faixa de 30-40s. Vídeo curto demais não dá tempo de construir a oferta.`,
    },
    ideal: {
      cls: "text-[#10b981]",
      tag: null,
      tip: `Dentro da faixa recomendada (${VIDEO_DURACAO.idealMin}-${VIDEO_DURACAO.idealMax}s), que concentra 86% dos leads da carteira com 72% da verba.`,
    },
    aceitavel: {
      cls: "text-[color:var(--foreground)]",
      tag: null,
      tip: `Acima do ideal (${VIDEO_DURACAO.idealMax}s) mas dentro do limite. Amostra pequena nessa faixa — sem evidência forte contra.`,
    },
    longo: {
      cls: "text-[#d97706] dark:text-[#fbbf24]",
      tag: "longo",
      tip: `Acima de ${VIDEO_DURACAO.limiteLongo}s. Na carteira, essa faixa tem a PIOR qualificação: 0,018 MQL por mil reproduções contra 0,086 na faixa de 40-50s.`,
    },
  };
  const c = cfg[status ?? "ideal"];
  return (
    <span className="inline-flex items-center gap-1.5" title={c.tip}>
      <span className={"text-xs font-semibold tabular-nums " + c.cls}>{s}s</span>
      {c.tag && (
        <span className="rounded bg-[#d97706]/12 px-1 text-[9px] font-bold uppercase text-[#d97706] dark:text-[#fbbf24]">
          {c.tag}
        </span>
      )}
    </span>
  );
}

function Rate({
  v,
  t,
  raw,
  title,
}: {
  v: number;
  t: [number, number, number];
  raw: boolean;
  title?: string;
}) {
  return (
    <td className="px-4 py-2 text-right" title={title}>
      {raw ? (
        // Amostra baixa: mostra o número sem julgar com cor.
        <span className="text-xs tabular-nums text-[color:var(--muted-foreground)]/70">
          {pct1(v)}
        </span>
      ) : (
        <span
          className={
            "inline-block min-w-[3.25rem] rounded px-2 py-1 text-center text-[11px] font-bold tabular-nums " +
            heat(v, t)
          }
        >
          {pct1(v)}
        </span>
      )}
    </td>
  );
}

function FunnelCard({
  label,
  value,
  sub,
  meta,
  metaTip,
  ok,
  neutral,
}: {
  label: string;
  value: string;
  sub: string;
  meta?: string;
  /** Explica de onde vem a meta — e, no body, que ela varia por duração. */
  metaTip?: string;
  ok?: boolean;
  neutral?: boolean;
}) {
  return (
    <div className="bg-[color:var(--card)] px-5 py-3.5">
      <div
        className={
          "font-[family-name:var(--font-montserrat)] text-lg font-bold leading-none " +
          (neutral
            ? "text-[color:var(--foreground)]"
            : ok
              ? "text-[#10b981]"
              : "text-[color:var(--foreground)]")
        }
      >
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[color:var(--muted-foreground)]/70">
        <span>{sub}</span>
        {meta && (
          <span
            className={
              "cursor-help rounded px-1 font-semibold " +
              (ok
                ? "bg-[#10b981]/12 text-[#10b981]"
                : "bg-[color:var(--muted)] text-[color:var(--muted-foreground)]")
            }
            title={metaTip ?? "Barra do verde — quartil superior da carteira Aton."}
          >
            meta {meta}
          </span>
        )}
      </div>
    </div>
  );
}
