import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import type { DateRange } from "./period";

// Meta Ads Insights (Graph API v21) — SOMENTE LEITURA.
//
// System User Aton_Ads_API (business 986509923276822) tem leitura das contas
// dos assinantes compartilhadas como parceiro. Token via env
// META_SYSTEM_USER_TOKEN (mesmo valor do projeto Aton Ads — nunca hardcodar).
//
// Vínculo workspace → conta: tabela wa_meta_ads_accounts (INSERT pra novos
// assinantes, sem deploy). O cruzamento com os leads acontece por
// id_anuncio (terrace360) = ad_id (Meta) — validado empiricamente (MDZ:
// 5/5 ids casando; Pacífico Breeze: 264 leads com sufixo da conta).
//
// Rate limits: a Insights API limita por conta → cache em memória 15min por
// (act_id, range). Flag global MEMBER_DASHBOARD_META_ADS_ENABLED (dark).

export function isMetaAdsEnabled(): boolean {
  return process.env.MEMBER_DASHBOARD_META_ADS_ENABLED === "true";
}

export type MetaAdInsight = {
  adId: string;
  adName: string | null;
  campaignName: string | null;
  spend: number;
  impressions: number;
  /** Cliques NO LINK (inline_link_clicks) — base do CTR/CPC de link. */
  linkClicks: number;
  /** CTR do LINK (inline_link_click_ctr), % — cliques no link ÷ impressões.
   *  NÃO o "CTR (todos)", que inclui reações/comentários/perfil. */
  ctr: number;
  /** Custo por clique NO LINK (cost_per_inline_link_click). */
  cpc: number;
  cpm: number;
  /** Thumbnail do criativo (CDN da Meta, URL assinada — expira; cache 15min mantém fresca). */
  thumbnailUrl: string | null;
  /** Formato do criativo — decide o badge (▶ vídeo / ⧉ carrossel) na tabela. */
  format: CreativeFormat;
};

export type CreativeFormat = "video" | "carousel" | "image";

export type MetaAdsData = {
  actId: string;
  accountName: string | null;
  currency: string; // ex.: BRL
  /** Insights só dos ads RELEVANTES (os que têm leads na base). */
  byAdId: Map<string, MetaAdInsight>;
  /** Total investido na CONTA no período (level=account — todos os ads). */
  totalSpend: number;
  /** Métricas agregadas da conta no período. */
  totalImpressions: number;
  /** Cliques NO LINK somados (base do CTR/CPC médio de link). */
  totalLinkClicks: number;
};

// ── Mapeamento workspace → conta (cache 10min) ─────────────────────────────
type AccountRow = { act_id: string; account_name: string | null };
const accountCache = new Map<string, { ts: number; row: AccountRow | null }>();
const ACCOUNT_TTL = 10 * 60_000;

async function getAccountForWorkspace(workspaceId: string): Promise<AccountRow | null> {
  const now = Date.now();
  const hit = accountCache.get(workspaceId);
  if (hit && now - hit.ts < ACCOUNT_TTL) return hit.row;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_meta_ads_accounts")
    .select("act_id, account_name")
    .eq("uchat_workspace_id", workspaceId)
    .eq("enabled", true)
    .maybeSingle<AccountRow>();
  if (error) {
    console.error("[meta-ads] account lookup", { workspaceId, message: error.message });
    return null;
  }
  accountCache.set(workspaceId, { ts: now, row: data ?? null });
  return data ?? null;
}

// ── Insights (cache 15min por act+range+ids; negativo 2min) ────────────────
const insightsCache = new Map<string, { ts: number; data: MetaAdsData }>();
const INSIGHTS_TTL = 15 * 60_000;
// Falha/deadline → não martelar o Meta a cada pageview: 2min sem retry.
const negativeCache = new Map<string, number>();
const NEGATIVE_TTL = 2 * 60_000;
const TIMEOUT_MS = 12_000;
// Orçamento TOTAL da camada Meta por render: estourou → página sai sem a
// camada de custo (nunca pendurar o dash por causa do Meta).
const DEADLINE_MS = 10_000;

function num(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // code 190 no detail = token invalidado (regerar no Business Settings).
      console.error("[meta-ads] !ok", { status: res.status, detail: detail.slice(0, 180) });
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.error("[meta-ads] fetch falhou", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Thumbnails + formato dos criativos em batch (`?ids=` aceita até 50 por
 * chamada; chunks em PARALELO). Cosmético: falha degrada pra tabela sem
 * imagem — nunca derruba os dados de custo.
 */
type CreativeMeta = { thumb: string | null; format: CreativeFormat };
type CreativeNode = {
  creative?: {
    thumbnail_url?: string;
    video_id?: string;
    object_story_spec?: {
      video_data?: { video_id?: string };
      link_data?: { child_attachments?: unknown[] };
    };
  };
};

async function fetchCreativeThumbs(
  adIds: string[],
  token: string,
): Promise<Map<string, CreativeMeta>> {
  const out = new Map<string, CreativeMeta>();
  const fields =
    "creative.thumbnail_width(256).thumbnail_height(256)" +
    "{thumbnail_url,video_id,object_story_spec{video_data{video_id},link_data{child_attachments{link}}}}";
  const chunks: string[][] = [];
  for (let i = 0; i < adIds.length; i += 50) chunks.push(adIds.slice(i, i + 50));
  const results = await Promise.all(
    chunks.map((chunk) =>
      fetchJson(
        `https://graph.facebook.com/v21.0/?ids=${chunk.join(",")}` +
          `&fields=${fields}&access_token=${encodeURIComponent(token)}`,
      ),
    ),
  );
  for (const json of results) {
    if (!json || json.error) continue;
    for (const [id, v] of Object.entries(json as Record<string, CreativeNode>)) {
      const c = v?.creative;
      if (!c) continue;
      const isVideo = Boolean(c.video_id || c.object_story_spec?.video_data?.video_id);
      const isCarousel = (c.object_story_spec?.link_data?.child_attachments?.length ?? 0) >= 2;
      out.set(id, {
        thumb: c.thumbnail_url ?? null,
        format: isVideo ? "video" : isCarousel ? "carousel" : "image",
      });
    }
  }
  return out;
}

/**
 * Camada Meta do dash em 3 chamadas PARALELAS (era 1 varredura paginada da
 * conta inteira — a Brows tem 487 ads históricos e levava 17-33s; assim leva
 * <1s):
 *   a) level=account → totais do strip (spend/impressions/linkClicks);
 *   b) level=ad + filtering ad.id IN(relevantes) → só os ads que têm leads
 *      na base (a tabela não usa outros);
 *   c) thumbs/formato só dos relevantes.
 * null = flag off / sem conta / erro / deadline (degrada silencioso — o dash
 * renderiza sem a camada de custo; NUNCA pendura a página).
 */
export async function getMetaAdsForWorkspace(
  workspaceId: string,
  range: DateRange,
  relevantAdIds: string[],
): Promise<MetaAdsData | null> {
  if (!isMetaAdsEnabled()) return null;
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) return null;

  const account = await getAccountForWorkspace(workspaceId);
  if (!account) return null;

  const ids = [...new Set(relevantAdIds.map((s) => s.trim()).filter((s) => /^\d{5,25}$/.test(s)))];
  const rangeKey = `${range.from ?? "max"}|${range.to ?? "max"}`;
  const cacheKey = `${account.act_id}|${rangeKey}|${ids.slice().sort().join(",")}`;
  const now = Date.now();
  const hit = insightsCache.get(cacheKey);
  if (hit && now - hit.ts < INSIGHTS_TTL) return hit.data;
  const neg = negativeCache.get(cacheKey);
  if (neg && now - neg < NEGATIVE_TTL) return null;

  // Range do dash → parâmetro do Meta. "Todo período" → date_preset=maximum.
  const rangeParam =
    range.from && range.to
      ? `time_range=${encodeURIComponent(JSON.stringify({ since: range.from, until: range.to }))}`
      : "date_preset=maximum";

  const G = "https://graph.facebook.com/v21.0";
  const tokenParam = `access_token=${encodeURIComponent(token)}`;

  const work = (async (): Promise<MetaAdsData | null> => {
    // (a) totais da conta — strip custo × desfecho.
    const accountP = fetchJson(
      `${G}/${account.act_id}/insights?level=account&${rangeParam}` +
        `&fields=spend,impressions,inline_link_clicks,account_currency&${tokenParam}`,
    );

    // (b) insights só dos ads relevantes (chunks de 80 no IN, em paralelo).
    const adChunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 80) adChunks.push(ids.slice(i, i + 80));
    const adFields =
      "ad_id,ad_name,campaign_name,spend,impressions,inline_link_clicks,inline_link_click_ctr,cost_per_inline_link_click,cpm,account_currency";
    const adsP = Promise.all(
      adChunks.map((chunk) => {
        const filt = encodeURIComponent(
          JSON.stringify([{ field: "ad.id", operator: "IN", value: chunk }]),
        );
        return fetchJson(
          `${G}/${account.act_id}/insights?level=ad&${rangeParam}&filtering=${filt}` +
            `&fields=${adFields}&limit=200&${tokenParam}`,
        );
      }),
    );

    // (c) identidade visual dos relevantes.
    const thumbsP = ids.length > 0 ? fetchCreativeThumbs(ids, token) : Promise.resolve(new Map<string, CreativeMeta>());

    const [accountJson, adsJsons, thumbs] = await Promise.all([accountP, adsP, thumbsP]);
    if (!accountJson) return null;

    const acc = (accountJson.data as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    let currency = (acc.account_currency as string) || "BRL";

    const byAdId = new Map<string, MetaAdInsight>();
    for (const json of adsJsons) {
      if (!json) continue;
      for (const r of (json.data as Array<Record<string, unknown>> | undefined) ?? []) {
        const adId = String(r.ad_id ?? "").trim();
        if (!adId) continue;
        const meta = thumbs.get(adId);
        byAdId.set(adId, {
          adId,
          adName: (r.ad_name as string) ?? null,
          campaignName: (r.campaign_name as string) ?? null,
          spend: num(r.spend),
          impressions: num(r.impressions),
          linkClicks: num(r.inline_link_clicks),
          ctr: num(r.inline_link_click_ctr),
          cpc: num(r.cost_per_inline_link_click),
          cpm: num(r.cpm),
          thumbnailUrl: meta?.thumb ?? null,
          format: meta?.format ?? "image",
        });
        currency = (r.account_currency as string) || currency;
      }
    }

    return {
      actId: account.act_id,
      accountName: account.account_name,
      currency,
      byAdId,
      totalSpend: num(acc.spend),
      totalImpressions: num(acc.impressions),
      totalLinkClicks: num(acc.inline_link_clicks),
    };
  })();

  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), DEADLINE_MS));
  const data = await Promise.race([work, deadline]);

  if (!data) {
    console.error("[meta-ads] sem dados (erro ou deadline)", { actId: account.act_id, rangeKey });
    negativeCache.set(cacheKey, now);
    return null;
  }
  negativeCache.delete(cacheKey);
  insightsCache.set(cacheKey, { ts: now, data });
  return data;
}

// ── Shape serializável pro client (Map não atravessa a fronteira RSC) ───────
// DECISÃO (Murillo): a contagem de leads usada em TODOS os cálculos é a da
// base Aton (fonte da verdade). Leads/CPL reportados pelo Meta são
// frequentemente errôneos → NÃO são enviados ao client nem exibidos.
export type MetaAdsForTable = {
  currency: string;
  totalSpend: number;
  avgCtr: number; // CTR de LINK ponderado: linkClicks/impressions*100
  avgCpc: number; // custo por clique no LINK: spend/linkClicks
  /**
   * por ad_id: [spend, ctr, cpc, cpm, adName, thumbnailUrl, campaignName,
   * format] — métricas de mídia + identidade visual (nada de leads do Meta).
   */
  ads: Record<
    string,
    [
      number,
      number,
      number,
      number,
      string | null,
      string | null,
      string | null,
      CreativeFormat,
    ]
  >;
};

// ── Preview oficial do anúncio (Ad Preview API) ─────────────────────────────
// Devolve o src do iframe da Meta que renderiza o anúncio REAL — vídeo
// tocável, carrossel navegável. Validado: renderiza sem login no Facebook e
// sem bloqueio de framing (X-Frame-Options/frame-ancestors ausentes).
// O src expira (~24h) → cache 30min. MOBILE_FEED_STANDARD porque as
// campanhas dos assinantes são mobile/WhatsApp; fallback DESKTOP.
const previewCache = new Map<string, { ts: number; src: string }>();
const PREVIEW_TTL = 30 * 60_000;

export async function getAdPreviewForWorkspace(
  workspaceId: string,
  adId: string,
): Promise<{ src: string } | null> {
  if (!isMetaAdsEnabled()) return null;
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) return null;
  if (!/^\d{5,25}$/.test(adId)) return null;

  const account = await getAccountForWorkspace(workspaceId);
  if (!account) return null;

  const now = Date.now();
  const hit = previewCache.get(adId);
  if (hit && now - hit.ts < PREVIEW_TTL) return { src: hit.src };

  try {
    // Escopo por tenant: o anúncio precisa pertencer à conta DESTE workspace
    // (impede sondar previews de outros assinantes com uma sessão válida).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const owner = (await (
      await fetch(
        `https://graph.facebook.com/v21.0/${adId}?fields=account_id&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store", signal: controller.signal },
      )
    ).json()) as { account_id?: string; error?: unknown };
    clearTimeout(timer);
    if (!owner.account_id || `act_${owner.account_id}` !== account.act_id) return null;

    for (const fmt of ["MOBILE_FEED_STANDARD", "DESKTOP_FEED_STANDARD"]) {
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), TIMEOUT_MS);
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${adId}/previews?ad_format=${fmt}&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store", signal: c2.signal },
      );
      clearTimeout(t2);
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: Array<{ body?: string }> };
      const body = (json.data?.[0]?.body ?? "").replace(/&amp;/g, "&");
      const src = /src="([^"]+)"/.exec(body)?.[1];
      if (src && src.startsWith("https://")) {
        previewCache.set(adId, { ts: now, src });
        return { src };
      }
    }
  } catch (e) {
    console.error("[meta-ads] preview falhou", {
      adId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return null;
}

export function toTablePayload(d: MetaAdsData): MetaAdsForTable {
  const ads: MetaAdsForTable["ads"] = {};
  for (const [id, a] of d.byAdId) {
    ads[id] = [
      a.spend,
      a.ctr,
      a.cpc,
      a.cpm,
      a.adName,
      a.thumbnailUrl,
      a.campaignName,
      a.format,
    ];
  }
  return {
    currency: d.currency,
    totalSpend: d.totalSpend,
    // CTR/CPC de LINK ponderados pela conta (cliques no link ÷ impressões).
    avgCtr: d.totalImpressions > 0 ? (d.totalLinkClicks / d.totalImpressions) * 100 : 0,
    avgCpc: d.totalLinkClicks > 0 ? d.totalSpend / d.totalLinkClicks : 0,
    ads,
  };
}
