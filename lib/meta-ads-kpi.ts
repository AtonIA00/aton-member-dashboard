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
// não é escolha de ninguém. Medi se valia como alarme: dos 7 anúncios abaixo
// de 85%, os piores eram CARROSSEL/formato misto (3,0% e 4,4%), que a seção já
// exclui pelo filtro de formato. Segue disponível no endpoint do Core como
// video_play_rate (dado cru, sem custo visual).
export const VIDEO_KPI = {
  /** ≥3s ÷ reproduções. Quem passa do hook (0-5s). Richard: 40-50% é muito bom
   *  no mercado imobiliário (resposta direta agressiva: >60%). */
  retHook: { t: [18, 26, 40] as [number, number, number], meta: "40-50%" },
  /** 75% ÷ reproduções. Quem consome a mensagem de venda inteira.
   *  Meta >2% — confere com o p25 real da carteira (1,9%). */
  retBody: { t: [1.5, 2, 4.8] as [number, number, number], meta: "> 2%" },
} as const;

/** Volume mínimo de reproduções pra taxa não ser ruído (abaixo disso a UI
 *  marca a linha como amostra baixa em vez de pintar heat). */
export const VIDEO_MIN_PLAYS = 200;
