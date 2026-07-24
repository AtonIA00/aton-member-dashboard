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
  /** Leads segundo o Meta (action_type lead/lead_grouped/leadgen_grouped). */
  metaLeads: number;
  /** CPL segundo o Meta (cost_per_action_type do lead). */
  metaCpl: number | null;
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
  /** Insights por ad_id (chave = ad_id). */
  byAdId: Map<string, MetaAdInsight>;
  /** Total investido na conta no período (todos os ads, casando ou não). */
  totalSpend: number;
  /** Métricas agregadas da conta no período. */
  totalImpressions: number;
  /** Cliques NO LINK somados (base do CTR/CPC médio de link). */
  totalLinkClicks: number;
  /** Leads totais segundo o Meta. */
  totalMetaLeads: number;
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

// ── Insights (cache 15min por act+range) ───────────────────────────────────
const insightsCache = new Map<string, { ts: number; data: MetaAdsData }>();
const INSIGHTS_TTL = 15 * 60_000;
const TIMEOUT_MS = 12_000;

// action_types que contam como lead (ordem de preferência).
const LEAD_ACTIONS = ["onsite_conversion.lead_grouped", "leadgen_grouped", "lead"];

function num(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
}

function pickLead(list: Array<{ action_type?: string; value?: string }> | undefined): number | null {
  if (!Array.isArray(list)) return null;
  for (const t of LEAD_ACTIONS) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return null;
}

/**
 * Thumbnails + formato dos criativos em batch (`?ids=` aceita até 50 por
 * chamada). Cosmético: qualquer falha degrada pra tabela sem imagem — nunca
 * derruba os dados de custo. Os ids vêm dos insights da conta, então existem.
 */
type CreativeMeta = { thumb: string | null; format: CreativeFormat };

async function fetchCreativeThumbs(
  adIds: string[],
  token: string,
): Promise<Map<string, CreativeMeta>> {
  const out = new Map<string, CreativeMeta>();
  const fields =
    "creative.thumbnail_width(256).thumbnail_height(256)" +
    "{thumbnail_url,video_id,object_story_spec{video_data{video_id},link_data{child_attachments{link}}}}";
  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    const url =
      `https://graph.facebook.com/v21.0/?ids=${chunk.join(",")}` +
      `&fields=${fields}&access_token=${encodeURIComponent(token)}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = (await res.json()) as Record<
        string,
        {
          creative?: {
            thumbnail_url?: string;
            video_id?: string;
            object_story_spec?: {
              video_data?: { video_id?: string };
              link_data?: { child_attachments?: unknown[] };
            };
          };
        }
      >;
      for (const [id, v] of Object.entries(json)) {
        const c = v?.creative;
        if (!c) continue;
        const isVideo = Boolean(c.video_id || c.object_story_spec?.video_data?.video_id);
        const isCarousel = (c.object_story_spec?.link_data?.child_attachments?.length ?? 0) >= 2;
        out.set(id, {
          thumb: c.thumbnail_url ?? null,
          format: isVideo ? "video" : isCarousel ? "carousel" : "image",
        });
      }
    } catch {
      // segue sem thumbs deste chunk
    }
  }
  return out;
}

/**
 * Puxa insights por anúncio da conta do workspace no range do dash.
 * null = sem conta vinculada / flag off / erro (degrada silencioso — o dash
 * renderiza sem a camada de custo).
 */
export async function getMetaAdsForWorkspace(
  workspaceId: string,
  range: DateRange,
): Promise<MetaAdsData | null> {
  if (!isMetaAdsEnabled()) return null;
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) return null;

  const account = await getAccountForWorkspace(workspaceId);
  if (!account) return null;

  const rangeKey = `${range.from ?? "max"}|${range.to ?? "max"}`;
  const cacheKey = `${account.act_id}|${rangeKey}`;
  const now = Date.now();
  const hit = insightsCache.get(cacheKey);
  if (hit && now - hit.ts < INSIGHTS_TTL) return hit.data;

  // Range do dash → parâmetro do Meta. "Todo período" → date_preset=maximum.
  const rangeParam =
    range.from && range.to
      ? `time_range=${encodeURIComponent(JSON.stringify({ since: range.from, until: range.to }))}`
      : "date_preset=maximum";

  const fields =
    "ad_id,ad_name,campaign_name,spend,impressions,inline_link_clicks,inline_link_click_ctr,cost_per_inline_link_click,cpm,actions,cost_per_action_type,account_currency";
  let url: string | null =
    `https://graph.facebook.com/v21.0/${account.act_id}/insights?level=ad&${rangeParam}&fields=${fields}&limit=200&access_token=${encodeURIComponent(token)}`;

  const byAdId = new Map<string, MetaAdInsight>();
  let currency = "BRL";
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalLinkClicks = 0;
  let totalMetaLeads = 0;

  try {
    // Paginação: segue paging.next (máx 10 páginas — backstop).
    for (let page = 0; url && page < 10; page++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res: Response = await fetch(url, { cache: "no-store", signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error("[meta-ads] insights !ok", {
          actId: account.act_id,
          status: res.status,
          detail: detail.slice(0, 200), // code 190 = token invalidado (regerar no BM)
        });
        return null;
      }
      const json = (await res.json()) as {
        data?: Array<Record<string, unknown>>;
        paging?: { next?: string };
      };
      for (const r of json.data ?? []) {
        const adId = String(r.ad_id ?? "").trim();
        if (!adId) continue;
        const actions = r.actions as Array<{ action_type?: string; value?: string }> | undefined;
        const cpa = r.cost_per_action_type as Array<{ action_type?: string; value?: string }> | undefined;
        const insight: MetaAdInsight = {
          adId,
          adName: (r.ad_name as string) ?? null,
          campaignName: (r.campaign_name as string) ?? null,
          spend: num(r.spend),
          impressions: num(r.impressions),
          linkClicks: num(r.inline_link_clicks),
          ctr: num(r.inline_link_click_ctr),
          cpc: num(r.cost_per_inline_link_click),
          cpm: num(r.cpm),
          metaLeads: pickLead(actions) ?? 0,
          metaCpl: pickLead(cpa),
          thumbnailUrl: null,
          format: "image",
        };
        byAdId.set(adId, insight);
        currency = (r.account_currency as string) || currency;
        totalSpend += insight.spend;
        totalImpressions += insight.impressions;
        totalLinkClicks += insight.linkClicks;
        totalMetaLeads += insight.metaLeads;
      }
      url = json.paging?.next ?? null;
    }
  } catch (e) {
    console.error("[meta-ads] fetch falhou", {
      actId: account.act_id,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  if (byAdId.size > 0) {
    const thumbs = await fetchCreativeThumbs([...byAdId.keys()], token);
    for (const [id, meta] of thumbs) {
      const insight = byAdId.get(id);
      if (insight) {
        insight.thumbnailUrl = meta.thumb;
        insight.format = meta.format;
      }
    }
  }

  const data: MetaAdsData = {
    actId: account.act_id,
    accountName: account.account_name,
    currency,
    byAdId,
    totalSpend,
    totalImpressions,
    totalLinkClicks,
    totalMetaLeads,
  };
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
