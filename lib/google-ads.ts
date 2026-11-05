import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import { isoDay, type DateRange } from "./period";
import { getBaseStartForWorkspace } from "./meta-ads";
import type { MetaAdsForTable, MetaAdTuple } from "./meta-ads-kpi";

// ── Google Ads (05/11/2026, começa pela All Resort 316919) ─────────────────
// O Core sincroniza o gasto diário (google_ads_insights, por dia × grupo de
// anúncios) das contas de wa_google_ads_accounts. Aqui só se LÊ e soma no
// período do filtro. O lead casa pela CAMPANHA: id_anuncio
// "Google · <campaign_id ou nome curto> · <empreendimento>". Conversão do
// Google não entra: a contagem de leads é sempre a da base Aton.

export type GoogleAdsPeriodo = {
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  campanhas: { id: string; nome: string; spend: number; impressions: number; clicks: number }[];
};

const cache = new Map<string, { ts: number; data: GoogleAdsPeriodo | null }>();
const TTL = 15 * 60_000;

export async function getGoogleAdsForWorkspace(workspaceId: string, range: DateRange): Promise<GoogleAdsPeriodo | null> {
  const supabase = getSupabaseAdmin();
  const { data: contas, error } = await supabase
    .from("wa_google_ads_accounts")
    .select("customer_id")
    .eq("uchat_workspace_id", workspaceId)
    .eq("enabled", true);
  if (error || !contas?.length) return null;

  let since = range.from;
  let until = range.to;
  if (!since || !until) {
    since = (await getBaseStartForWorkspace(workspaceId)) ?? "2000-01-01";
    until = isoDay(new Date());
  }
  const ids = contas.map((c) => String(c.customer_id));
  const chave = `${ids.sort().join(",")}|${since}|${until}`;
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const { data: linhas, error: e2 } = await supabase
    .from("google_ads_insights")
    .select("campaign_id, campaign_name, custo, impressoes, cliques")
    .in("customer_id", ids)
    .gte("data", since)
    .lte("data", until)
    .limit(20000);
  if (e2) {
    console.error("[google-ads] leitura", { workspaceId, message: e2.message });
    return null;
  }
  const porCamp = new Map<string, GoogleAdsPeriodo["campanhas"][number]>();
  for (const l of linhas ?? []) {
    const id = String(l.campaign_id);
    const c = porCamp.get(id) ?? { id, nome: String(l.campaign_name ?? id), spend: 0, impressions: 0, clicks: 0 };
    c.spend += Number(l.custo) || 0;
    c.impressions += Number(l.impressoes) || 0;
    c.clicks += Number(l.cliques) || 0;
    porCamp.set(id, c);
  }
  const campanhas = [...porCamp.values()].map((c) => ({ ...c, spend: Math.round(c.spend * 100) / 100 }));
  const data: GoogleAdsPeriodo = {
    totalSpend: Math.round(campanhas.reduce((t, c) => t + c.spend, 0) * 100) / 100,
    totalImpressions: campanhas.reduce((t, c) => t + c.impressions, 0),
    totalClicks: campanhas.reduce((t, c) => t + c.clicks, 0),
    campanhas,
  };
  cache.set(chave, { ts: Date.now(), data });
  return data;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Campanha do Google de um id_anuncio "Google · <id ou nome> · <empreendimento>". */
function campanhaDoAnuncio(idAnuncio: string, g: GoogleAdsPeriodo) {
  const m = /^Google\s*·\s*([^·]+?)\s*·/i.exec(idAnuncio);
  if (!m) return null;
  const chave = m[1].trim();
  if (/^\d+$/.test(chave)) return g.campanhas.find((c) => c.id === chave) ?? null;
  // utm_campaign com nome curto (ex.: "institucional" → "[GH] [Search] Institucional").
  const alvo = semAcento(chave);
  const achadas = g.campanhas.filter((c) => semAcento(c.nome).includes(alvo));
  return achadas.length === 1 ? achadas[0] : null;
}

/**
 * Junta o Google ao payload da tabela (que nasceu Meta). O investimento do topo
 * passa a ser Meta + Google. Por linha: só quando a campanha tem UMA linha na
 * tabela (nome + gasto); campanha dividida entre empreendimentos fica com "—"
 * por linha (não dá para repartir sem inventar), mas soma no topo.
 */
export function comGoogle(meta: MetaAdsForTable | null, g: GoogleAdsPeriodo | null, idsAnuncio: string[]): MetaAdsForTable | null {
  if (!g || g.totalSpend <= 0) return meta;
  const base: MetaAdsForTable = meta ?? { currency: "BRL", totalSpend: 0, avgCtr: 0, avgCpc: 0, avgCpm: 0, ads: {} };
  const linhasPorCamp = new Map<string, string[]>();
  for (const id of idsAnuncio) {
    const c = campanhaDoAnuncio(id, g);
    if (!c) continue;
    linhasPorCamp.set(c.id, [...(linhasPorCamp.get(c.id) ?? []), id]);
  }
  const ads = { ...base.ads };
  for (const [campId, linhas] of linhasPorCamp) {
    const c = g.campanhas.find((x) => x.id === campId)!;
    const sozinha = linhas.length === 1;
    if (!sozinha) continue;
    for (const id of linhas) {
      const spend = c.spend;
      const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
      const tupla: MetaAdTuple = [
        spend,
        ctr,
        c.clicks > 0 ? c.spend / c.clicks : 0,
        c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
        c.nome,
        null,
        "Google Ads",
        "image",
        c.impressions,
        c.clicks,
        0,
        0,
        0,
        null,
      ];
      ads[id] = tupla;
    }
  }
  return { ...base, totalSpend: Math.round((base.totalSpend + g.totalSpend) * 100) / 100, googleSpend: g.totalSpend, ads };
}
