// Parte CLIENT-SAFE da camada Meta Ads: tipos do payload, acesso nomeado à
// tupla e as metas dos KPIs de vídeo.
//
// Vive fora de lib/meta-ads.ts porque aquele arquivo é `server-only` (guarda o
// token) — componente cliente que importasse VALOR de lá quebra o build. Só
// tipo pode atravessar (é apagado na compilação). Aqui não há segredo nem
// fetch, então cliente e servidor consomem igual.
//
// lib/meta-ads.ts re-exporta tudo isto, então imports antigos seguem válidos.

export type CreativeFormat = "video" | "carousel" | "image";

export type MetaAdTuple = [
  number, // 0 spend
  number, // 1 ctr (link, %)
  number, // 2 cpc (link)
  number, // 3 cpm
  string | null, // 4 adName
  string | null, // 5 thumbnailUrl
  string | null, // 6 campaignName
  CreativeFormat, // 7 format
  number, // 8 impressions
  number, // 9 linkClicks
  number, // 10 plays
  number, // 11 views3s
  number, // 12 p75
  number | null, // 13 duracaoSeg
];

export type MetaAdRow = {
  spend: number;
  ctr: number;
  cpc: number;
  cpm: number;
  adName: string | null;
  thumbnailUrl: string | null;
  campaignName: string | null;
  format: CreativeFormat;
  impressions: number;
  linkClicks: number;
  plays: number;
  views3s: number;
  p75: number;
  duracaoSeg: number | null;
};

// ── Shape serializável pro client (Map não atravessa a fronteira RSC) ───────
// DECISÃO (Murillo): a contagem de leads usada em TODOS os cálculos é a da
// base Aton (fonte da verdade). Leads/CPL reportados pelo Meta são
// frequentemente errôneos → NÃO são enviados ao client nem exibidos.
export type MetaAdsForTable = {
  currency: string;
  totalSpend: number;
  avgCtr: number; // CTR de LINK ponderado: linkClicks/impressions*100
  avgCpc: number; // custo por clique no LINK: spend/linkClicks
  /** CPM ponderado da conta: spend/impressions*1000. */
  avgCpm: number;
  /**
   * por ad_id: tupla acima. impressions/linkClicks são as BASES CRUAS de cpm
   * e ctr — a tabela mostra cada razão com seu denominador/numerador, pra o
   * número poder ser conferido na tela (0,61% com 100 cliques ≠ com 6).
   * plays/views3s/p75 são a base dos KPIs de retenção de vídeo.
   *
   * Tupla (não objeto) pra enxugar o payload RSC. Consuma via adRow() —
   * acesso por índice espalhado pelo código é convite a bug.
   */
  ads: Record<string, MetaAdTuple>;
};

/** Acesso NOMEADO à tupla do payload — use isto, não t[8]. */
export function adRow(t: MetaAdTuple): MetaAdRow {
  return {
    spend: t[0],
    ctr: t[1],
    cpc: t[2],
    cpm: t[3],
    adName: t[4],
    thumbnailUrl: t[5],
    campaignName: t[6],
    format: t[7],
    impressions: t[8],
    linkClicks: t[9],
    plays: t[10],
    views3s: t[11],
    p75: t[12],
    duracaoSeg: t[13],
  };
}

/**
 * Metas dos KPIs de retenção de vídeo — metodologia do Richard (especialista
 * em métricas de vídeo), conversa de 2026-08-05.
 *
 * Cada tupla é [t0, t1, t2]: verde ≥ t2, amarelo ≥ t1, laranja ≥ t0, vermelho
 * abaixo. O VERDE é sempre a meta do Richard; t0/t1 vêm dos percentis reais da
 * carteira (173 anúncios de vídeo com ≥200 reproduções, 13 contas, 90d, medido
 * em 2026-08-05) pra cor continuar informativa.
 *
 * Sem isso o painel viraria um mar de vermelho: a meta de 40% de retenção do
 * hook é atingida por só 13% dos anúncios (mediana real 25,9%) — mesmo erro
 * dos thresholds antigos do heatmap, já corrigido.
 */
// Play rate (reproduções ÷ impressões) foi REMOVIDO do dash a pedido do
// Murillo (2026-08-05): 93% da carteira passa da meta de 90% (mediana 95,9%),
// então não separa criativo bom de ruim — o vídeo dá autoplay, a "reprodução"
// não é escolha de ninguém. Segue disponível no endpoint do Core como
// video_play_rate (dado cru, sem custo visual).

// ══════════════════════════════════════════════════════════════════════════
// METAS — recalibradas em 2026-08-09 com os dados da própria carteira.
//
// Base: 174 criativos de vídeo com ≥200 reproduções, 12 contas, 90 dias.
// Duração conhecida em 80 deles (o resto é bloqueado por permissão de página).
//
// O QUE MUDOU E POR QUÊ:
//
// 1) HOOK: verde saiu de 40% (meta do Richard) para 35% (p75 real da carteira).
//    Motivo empírico: o quartil de melhor hook (mediana 39,9% — exatamente na
//    meta antiga) tem CPL PIOR que o 3º quartil (R$ 42,83 vs R$ 26,98) e menos
//    lead por mil reproduções (0,237 vs 0,885). Perseguir 40% leva a uma zona
//    onde o resultado piora. 35% = topo do quartil superior, atingível e
//    associado ao melhor desfecho.
//    Escala única: duração NÃO altera hook de forma relevante (rho=+0,19, e as
//    medianas por faixa não são monotônicas). Testei e não se sustenta.
//
// 2) BODY: régua VARIÁVEL por duração. Aqui o confundidor é forte e mecânico —
//    duração × retenção de body dá rho=-0,45 (p<0,001): chegar a 75% de um
//    vídeo de 60s é matematicamente mais difícil que de um de 25s. Medianas
//    reais por faixa: até 35s = 2,6% · 35-50s = 2,3% · 50s+ = 1,6%. Uma régua
//    única condenaria todo vídeo longo por geometria, não por qualidade.
// ══════════════════════════════════════════════════════════════════════════

export const VIDEO_KPI = {
  /** ≥3s ÷ reproduções — quem passa do hook (0-5s).
   *  [p25, mediana, p75] da carteira. Verde = quartil superior. */
  retHook: { t: [18, 26, 35] as [number, number, number], meta: "≥ 35%" },
  /** Régua BASE do body (vídeo de 35-50s, a faixa mais comum). Use
   *  bodyThresholds(duracao) — não esta constante direto. */
  retBody: { t: [1.9, 2.8, 4.9] as [number, number, number], meta: "≥ 2,8%" },
} as const;

/**
 * Régua do body ajustada pela duração. Os fatores vêm das medianas reais por
 * faixa (2,6 / 2,3 / 1,6 → ×1,13 / ×1,00 / ×0,70 sobre a base).
 * Duração desconhecida → régua base (metade dos criativos cai aqui: a Meta
 * bloqueia a duração de vídeo cuja página não compartilhamos).
 */
export function bodyThresholds(duracaoSeg: number | null): [number, number, number] {
  if (duracaoSeg == null) return [1.9, 2.8, 4.9];
  if (duracaoSeg < 35) return [2.1, 3.2, 5.5];
  if (duracaoSeg < 50) return [1.9, 2.8, 4.9];
  return [1.3, 2.0, 3.4];
}

/**
 * Duração recomendada, derivada do desfecho real (90d, 80 criativos):
 *
 *   até 30s  n=29  0,143 lead/1k  CPL R$ 262   ← pior faixa da carteira
 *   30-40s   n=18  0,420 lead/1k  CPL R$  61   ← melhor CPL
 *   40-50s   n=15  0,221 lead/1k  CPL R$  75   ← melhor MQL/1k (0,086)
 *   50-60s   n= 5  0,236 lead/1k  CPL R$ 189   (amostra fraca)
 *   60s+     n=13  0,126 lead/1k  CPL R$ 100   ← pior qualificação (0,018 MQL/1k)
 *
 * 30-50s concentra 72% da verba e 86% dos leads. Contra-intuitivo e
 * importante: o risco maior é o vídeo CURTO (CPL R$262), não o longo.
 */
export const VIDEO_DURACAO = { idealMin: 30, idealMax: 50, limiteLongo: 60 } as const;

export type DuracaoStatus = "curto" | "ideal" | "aceitavel" | "longo";

export function duracaoStatus(seg: number | null): DuracaoStatus | null {
  if (seg == null) return null;
  if (seg < VIDEO_DURACAO.idealMin) return "curto";
  if (seg <= VIDEO_DURACAO.idealMax) return "ideal";
  if (seg <= VIDEO_DURACAO.limiteLongo) return "aceitavel";
  return "longo";
}

/** Volume mínimo de reproduções pra taxa não ser ruído (abaixo disso a UI
 *  marca a linha como amostra baixa em vez de pintar heat). */
export const VIDEO_MIN_PLAYS = 200;
