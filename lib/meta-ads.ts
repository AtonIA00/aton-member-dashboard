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
  clicks: number;
  ctr: number; // % (0..100, como o Meta manda)
  cpc: number;
  cpm: number;
  /** Leads segundo o Meta (action_type lead/lead_grouped/leadgen_grouped). */
  metaLeads: number;
  /** CPL segundo o Meta (cost_per_action_type do lead). */
  metaCpl: number | null;
};

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
  totalClicks: number;
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
    "ad_id,ad_name,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type,account_currency";
  let url: string | null =
    `https://graph.facebook.com/v21.0/${account.act_id}/insights?level=ad&${rangeParam}&fields=${fields}&limit=200&access_token=${encodeURIComponent(token)}`;

  const byAdId = new Map<string, MetaAdInsight>();
  let currency = "BRL";
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
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
          clicks: num(r.clicks),
          ctr: num(r.ctr),
          cpc: num(r.cpc),
          cpm: num(r.cpm),
          metaLeads: pickLead(actions) ?? 0,
          metaCpl: pickLead(cpa),
        };
        byAdId.set(adId, insight);
        currency = (r.account_currency as string) || currency;
        totalSpend += insight.spend;
        totalImpressions += insight.impressions;
        totalClicks += insight.clicks;
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

  const data: MetaAdsData = {
    actId: account.act_id,
    accountName: account.account_name,
    currency,
    byAdId,
    totalSpend,
    totalImpressions,
    totalClicks,
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
  avgCtr: number; // clicks/impressions*100 (ponderado)
  avgCpc: number; // spend/clicks
  /** por ad_id: [spend, ctr, cpc, cpm] — só métricas de mídia. */
  ads: Record<string, [number, number, number, number]>;
};

export function toTablePayload(d: MetaAdsData): MetaAdsForTable {
  const ads: MetaAdsForTable["ads"] = {};
  for (const [id, a] of d.byAdId) {
    ads[id] = [a.spend, a.ctr, a.cpc, a.cpm];
  }
  return {
    currency: d.currency,
    totalSpend: d.totalSpend,
    avgCtr: d.totalImpressions > 0 ? (d.totalClicks / d.totalImpressions) * 100 : 0,
    avgCpc: d.totalClicks > 0 ? d.totalSpend / d.totalClicks : 0,
    ads,
  };
}
