import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import { isoDay, type DateRange } from "./period";
import type {
  CreativeFormat,
  EntradaLead,
  MetaAdTuple,
  MetaAdsForTable,
} from "./meta-ads-kpi";

// Tipos/metas client-safe vivem no meta-ads-kpi.ts (este arquivo é
// server-only: componente cliente não pode importar valor daqui). Re-exporta
// pra manter os imports existentes funcionando.
export {
  adRow,
  ENTRADA_LABEL,
  ENTRADA_ORDEM,
  VIDEO_KPI,
  VIDEO_MIN_PLAYS,
  type EntradaLead,
  type CreativeFormat,
  type MetaAdTuple,
  type MetaAdRow,
  type MetaAdsForTable,
} from "./meta-ads-kpi";

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
  // ── Vídeo: base crua dos KPIs de retenção (metas em meta-ads-kpi.ts) ─────
  /** Reproduções do vídeo (video_play_actions) — 1º frame. */
  plays: number;
  /** Reproduções de ≥3s. Vem do action_type `video_view` do array `actions`:
   *  o campo video_3_sec_watched_actions FOI REMOVIDO na v21 (erro 100), e
   *  video_continuous_2_sec_watched_actions volta ZERADO em parte dos
   *  anúncios (medido: 1 de 4 na Brows, num anúncio com 242k reproduções).
   *  `video_view` é o "3 segundos" clássico da Meta e populou 100% da amostra. */
  views3s: number;
  /** Reproduções de 75% do vídeo (onde a mensagem de venda termina). */
  p75: number;
  /** Duração do vídeo em segundos. null quando a Meta bloqueia (erro 10: a
   *  página dona não foi compartilhada) — ~metade dos casos. Define a régua
   *  do body, que é mecanicamente dependente da duração. */
  duracaoSeg: number | null;
};

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
type AccountRow = {
  act_id: string;
  account_name: string | null;
  /** Campanhas que NÃO são do funil Aton deste assinante — só existe em
   *  conta COMPARTILHADA (o dono roda outros produtos na mesma conta).
   *  null/vazio = padrão: o investimento é o da conta inteira. */
  campanhas_excluidas: string[] | null;
};
const accountCache = new Map<string, { ts: number; row: AccountRow | null }>();
const ACCOUNT_TTL = 10 * 60_000;

async function getAccountForWorkspace(workspaceId: string): Promise<AccountRow | null> {
  const now = Date.now();
  const hit = accountCache.get(workspaceId);
  if (hit && now - hit.ts < ACCOUNT_TTL) return hit.row;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_meta_ads_accounts")
    .select("act_id, account_name, campanhas_excluidas")
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

// ── Início da base de leads do workspace (cache 60min) ─────────────────────
// "Todo período" no dash virava date_preset=maximum: até ~37 meses de
// histórico da CONTA de anúncios. Só que a base de leads da Aton de cada
// assinante começa muito depois — verba de anos dividida por leads de meses
// inflava o investimento exibido em 3,4x na carteira (ISJ Rio Preto: 12,8x;
// Emive: 9,3x). Ancorar o "Todo período" no 1º lead desta base põe
// numerador (verba) e denominador (leads) na MESMA janela.
//
// Deliberadamente ANTES das exclusões de lead de teste: a data marca quando
// a base passou a rastrear o assinante, não quem foi marcado como teste
// depois. Praticamente imutável → TTL longo.
const baseStartCache = new Map<string, { ts: number; day: string | null }>();
const BASE_START_TTL = 60 * 60_000;

async function getBaseStartForWorkspace(workspaceId: string): Promise<string | null> {
  const now = Date.now();
  const hit = baseStartCache.get(workspaceId);
  if (hit && now - hit.ts < BASE_START_TTL) return hit.day;

  const supabase = getSupabaseAdmin();
  // Mesma tabela do agregado de leads (lib/leads.ts).
  const { data, error } = await supabase
    .from("terrace360_leads_atonhub")
    .select("data")
    .eq("id_workspace_responsavel", workspaceId)
    .order("data", { ascending: true })
    .limit(1)
    .maybeSingle<{ data: string | null }>();
  if (error) {
    // Sem cache do erro: tenta de novo no próximo render (cai no maximum).
    console.error("[meta-ads] base start lookup", { workspaceId, message: error.message });
    return null;
  }
  const day = data?.data ? String(data.data).slice(0, 10) : null;
  baseStartCache.set(workspaceId, { ts: now, day });
  return day;
}

/** Normaliza pra casar exclusão: sem espaço nas pontas, minúsculo. O item
 *  cadastrado casa por campaign_id OU por campaign_name — quem cadastra vê
 *  nomes na tela da Meta, mas o id é estável se renomearem. */
const chaveCampanha = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

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

/** Métricas de vídeo vêm como [{action_type, value}] — pega o 1º valor. */
function actionValue(v: unknown): number {
  if (Array.isArray(v)) return num((v[0] as { value?: unknown } | undefined)?.value);
  return num(v);
}

/** Extrai um action_type específico do array `actions`. */
function pickActionType(list: unknown, type: string): number {
  if (!Array.isArray(list)) return 0;
  const hit = (list as Array<{ action_type?: string; value?: unknown }>).find(
    (a) => a.action_type === type,
  );
  return hit ? num(hit.value) : 0;
}

/** quiet: falha ESPERADA (ex.: duração de vídeo bloqueada, erro 10) — não
 *  loga, senão polui o log de produção a cada refresh de cache. */
async function fetchJson(
  url: string,
  quiet = false,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // code 190 no detail = token invalidado (regerar no Business Settings).
      if (!quiet) {
        console.error("[meta-ads] !ok", { status: res.status, detail: detail.slice(0, 180) });
      }
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
type CreativeMeta = {
  thumb: string | null;
  format: CreativeFormat;
  duracaoSeg: number | null;
  /** Conjunto do anúncio — é nele que mora o destination_type. */
  adsetId: string | null;
  /** O criativo abre um formulário DENTRO do WhatsApp (CTWA Flows)?
   *  true/false quando há mensagem de boas-vindas configurada; null quando
   *  não há (aí não dá pra afirmar nada). */
  flow: boolean | null;
};
type StoryData = {
  video_id?: string;
  child_attachments?: unknown[];
  /** JSON SERIALIZADO (string, não objeto) da mensagem de boas-vindas. */
  page_welcome_message?: string;
  call_to_action?: { type?: string; value?: { app_destination?: string } };
};
type CreativeNode = {
  adset_id?: string;
  creative?: {
    thumbnail_url?: string;
    video_id?: string;
    object_story_spec?: {
      video_data?: StoryData;
      link_data?: StoryData;
      photo_data?: StoryData;
    };
    asset_feed_spec?: { videos?: Array<{ video_id?: string }> };
  };
};

/**
 * Duração dos vídeos. NÃO dá pra pedir em lote grande: o endpoint `?ids=`
 * derruba o lote INTEIRO se um único id for inacessível — e ~metade dos
 * vídeos retorna erro 10 (a página dona não foi compartilhada com o System
 * User). Por isso: chunks de 5, tolerantes, em paralelo. Quem falha fica com
 * duração null e cai na régua base.
 */
async function fetchVideoDurations(
  videoIds: string[],
  token: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 5) chunks.push(videoIds.slice(i, i + 5));
  const res = await Promise.all(
    chunks.map((c) =>
      fetchJson(
        `https://graph.facebook.com/v21.0/?ids=${c.join(",")}&fields=length` +
          `&access_token=${encodeURIComponent(token)}`,
        true, // erro 10 (página não compartilhada) é esperado — não logar
      ),
    ),
  );
  for (const json of res) {
    if (!json || json.error) continue;
    for (const [id, v] of Object.entries(json as Record<string, { length?: number }>)) {
      const len = Number(v?.length);
      if (Number.isFinite(len) && len > 0) out.set(id, len);
    }
  }
  return out;
}

/**
 * O criativo abre um formulário DENTRO do WhatsApp (CTWA Flows)?
 *
 * O sinal mora em object_story_spec.*.page_welcome_message, que vem como
 * JSON SERIALIZADO (string). Validado nos criativos reais da Emive:
 *   landing_screen_type: "ctwa_flows"
 *   text_format.customer_action_type: "whatsapp_flow"
 *   ...automated_greeting_message_cta.wa_flow.flow_data.flow_id
 *
 * null quando não há mensagem de boas-vindas configurada — aí não dá pra
 * afirmar nem que tem nem que não tem formulário.
 */
function detectarFlow(pwm: string | undefined): boolean | null {
  if (typeof pwm !== "string" || pwm === "") return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(pwm) as Record<string, unknown>;
  } catch {
    // Boas-vindas ilegível: cai no texto cru em vez de mentir null.
    return /ctwa_flows|whatsapp_flow|flow_id/.test(pwm);
  }
  if (j.landing_screen_type === "ctwa_flows") return true;
  const midia = typeof j.media_type === "string" ? j.media_type : "text";
  const fmt = (j[`${midia}_format`] ?? j.text_format) as
    | { customer_action_type?: string }
    | undefined;
  if (fmt?.customer_action_type === "whatsapp_flow") return true;
  return JSON.stringify(j).includes('"flow_id"');
}

/**
 * Por qual porta o lead entra. Duas fontes, nenhuma inventada:
 *   destination_type do CONJUNTO diz o destino (ON_AD = formulário
 *   instantâneo da Meta, WHATSAPP = clique-para-WhatsApp);
 *   a mensagem de boas-vindas do CRIATIVO separa, dentro do WhatsApp, quem
 *   preenche formulário antes (flow) de quem cai direto na conversa.
 *
 * null de propósito em ON_VIDEO, INSTAGRAM_PROFILE, MESSENGER, UNDEFINED e
 * conjunto não encontrado: não são portas de captação, ou a Meta não disse.
 * Medido na carteira em 17/09/2026: 57 formulário Meta, 89 conversa direta,
 * 7 flow, 40 sem classificação.
 */
function classificarEntrada(
  destinationType: string | null,
  creative: CreativeMeta | undefined,
): EntradaLead | null {
  if (destinationType === "ON_AD") return "formulario_meta";
  if (destinationType === "WHATSAPP") {
    return creative?.flow === true ? "whatsapp_flow" : "whatsapp_direto";
  }
  return null;
}

/** destination_type dos conjuntos (lotes de 50, tolerante: lote que falha
 *  vira desconhecido em vez de derrubar a classificação inteira). */
async function fetchDestinationTypes(
  adsetIds: string[],
  token: string,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const chunks: string[][] = [];
  for (let i = 0; i < adsetIds.length; i += 50) chunks.push(adsetIds.slice(i, i + 50));
  const results = await Promise.all(
    chunks.map((chunk) =>
      fetchJson(
        `https://graph.facebook.com/v21.0/?ids=${chunk.join(",")}` +
          `&fields=destination_type&access_token=${encodeURIComponent(token)}`,
        true,
      ),
    ),
  );
  for (const json of results) {
    if (!json || json.error) continue;
    for (const [id, v] of Object.entries(json as Record<string, { destination_type?: string }>)) {
      out.set(id, v?.destination_type ?? null);
    }
  }
  return out;
}

async function fetchCreativeThumbs(
  adIds: string[],
  token: string,
): Promise<Map<string, CreativeMeta>> {
  const out = new Map<string, CreativeMeta>();
  // adset_id e a mensagem de boas-vindas entram NA MESMA chamada que já
  // buscava a miniatura — classificar a entrada do lead não custa request
  // novo. A string foi validada contra a API antes de entrar: campo aninhado
  // errado derruba a chamada inteira e levaria as miniaturas junto.
  const fields =
    "adset_id,creative.thumbnail_width(256).thumbnail_height(256)" +
    "{thumbnail_url,video_id,object_story_spec{" +
    "video_data{video_id,page_welcome_message,call_to_action}," +
    "link_data{child_attachments{link},page_welcome_message,call_to_action}," +
    "photo_data{page_welcome_message,call_to_action}}," +
    "asset_feed_spec{videos{video_id}}}";
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
  // 1ª passada: formato + thumb, guardando o video_id de cada anúncio.
  const videoDoAd = new Map<string, string>();
  for (const json of results) {
    if (!json || json.error) continue;
    for (const [id, v] of Object.entries(json as Record<string, CreativeNode>)) {
      const c = v?.creative;
      if (!c) continue;
      const videoId =
        c.video_id ??
        c.object_story_spec?.video_data?.video_id ??
        c.asset_feed_spec?.videos?.[0]?.video_id ??
        null;
      const isCarousel = (c.object_story_spec?.link_data?.child_attachments?.length ?? 0) >= 2;
      if (videoId) videoDoAd.set(id, String(videoId));
      const story =
        c.object_story_spec?.link_data ??
        c.object_story_spec?.video_data ??
        c.object_story_spec?.photo_data ??
        null;
      out.set(id, {
        thumb: c.thumbnail_url ?? null,
        format: videoId ? "video" : isCarousel ? "carousel" : "image",
        duracaoSeg: null,
        adsetId: v?.adset_id ? String(v.adset_id) : null,
        flow: detectarFlow(story?.page_welcome_message),
      });
    }
  }
  // 2ª passada: duração só dos vídeos (a régua do body depende dela).
  if (videoDoAd.size > 0) {
    const dur = await fetchVideoDurations([...new Set(videoDoAd.values())], token);
    for (const [adId, videoId] of videoDoAd) {
      const seg = dur.get(videoId);
      const meta = out.get(adId);
      if (meta && seg != null) meta.duracaoSeg = seg;
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
  // Range do dash → parâmetro do Meta. "Todo período" (from/to nulos) é
  // ancorado no 1º lead desta base — ver getBaseStartForWorkspace.
  let since = range.from;
  let until = range.to;
  if (!since || !until) {
    const baseStart = await getBaseStartForWorkspace(workspaceId);
    if (baseStart) {
      since = baseStart;
      until = isoDay(new Date());
    }
  }
  const rangeParam =
    since && until
      ? `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`
      : "date_preset=maximum"; // workspace sem lead nenhum: comportamento antigo

  // Chave de cache = janela EFETIVA (o "Todo período" resolvido muda de dia).
  const rangeKey = `${since ?? "max"}|${until ?? "max"}`;
  const cacheKey =
    `${account.act_id}|${rangeKey}|${ids.slice().sort().join(",")}` +
    `|x:${(account.campanhas_excluidas ?? []).slice().sort().join("~")}`;
  const now = Date.now();
  const hit = insightsCache.get(cacheKey);
  if (hit && now - hit.ts < INSIGHTS_TTL) return hit.data;
  const neg = negativeCache.get(cacheKey);
  if (neg && now - neg < NEGATIVE_TTL) return null;

  const G = "https://graph.facebook.com/v21.0";
  const tokenParam = `access_token=${encodeURIComponent(token)}`;

  // Conta COMPARTILHADA: quando há campanha excluída, os totais do strip não
  // podem vir de level=account (que soma a conta inteira, inclusive o que não
  // é do funil deste assinante). Aí a mesma informação vem de level=campaign e
  // somamos só o que ficou. Uma chamada, mesmo custo.
  // Sem exclusão — 14 das 15 contas hoje — o caminho é EXATAMENTE o de antes.
  const excluidas = new Set((account.campanhas_excluidas ?? []).map(chaveCampanha).filter(Boolean));
  const temExclusao = excluidas.size > 0;

  const work = (async (): Promise<MetaAdsData | null> => {
    // (a) totais do strip custo × desfecho.
    const accountP = temExclusao
      ? fetchJson(
          `${G}/${account.act_id}/insights?level=campaign&${rangeParam}` +
            `&fields=campaign_id,campaign_name,spend,impressions,inline_link_clicks,` +
            `account_currency&limit=500&${tokenParam}`,
        )
      : fetchJson(
          `${G}/${account.act_id}/insights?level=account&${rangeParam}` +
            `&fields=spend,impressions,inline_link_clicks,account_currency&${tokenParam}`,
        );

    // (b) insights só dos ads relevantes (chunks de 80 no IN, em paralelo).
    const adChunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 80) adChunks.push(ids.slice(i, i + 80));
    // `actions` entra só pelo action_type video_view (= 3s) — ver views3s.
    const adFields =
      "ad_id,ad_name,campaign_name,spend,impressions,inline_link_clicks,inline_link_click_ctr," +
      "cost_per_inline_link_click,cpm,account_currency," +
      "video_play_actions,video_p75_watched_actions,actions";
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

    const linhasTotais = (accountJson.data as Array<Record<string, unknown>> | undefined) ?? [];
    // Sem exclusão a resposta tem uma linha só (a conta). Com exclusão são as
    // campanhas — descarta as excluídas e soma o resto.
    const linhasValidas = temExclusao
      ? linhasTotais.filter(
          (r) =>
            !excluidas.has(chaveCampanha(r.campaign_id as string)) &&
            !excluidas.has(chaveCampanha(r.campaign_name as string)),
        )
      : linhasTotais;
    const somaTotais = linhasValidas.reduce<{ spend: number; impressions: number; linkClicks: number }>(
      (s, r) => ({
        spend: s.spend + num(r.spend),
        impressions: s.impressions + num(r.impressions),
        linkClicks: s.linkClicks + num(r.inline_link_clicks),
      }),
      { spend: 0, impressions: 0, linkClicks: 0 },
    );
    if (temExclusao) {
      const cortadas = linhasTotais.length - linhasValidas.length;
      if (cortadas === 0) {
        // Cadastro provavelmente errado (nome mudou na Meta, id trocado) —
        // silenciar viraria um CPL errado sem ninguém perceber.
        console.warn("[meta-ads] exclusão de campanha não casou com nada", {
          actId: account.act_id,
          cadastradas: [...excluidas],
        });
      }
    }
    const acc = linhasTotais[0] ?? {};
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
          duracaoSeg: meta?.duracaoSeg ?? null,
          plays: actionValue(r.video_play_actions),
          views3s: pickActionType(r.actions, "video_view"),
          p75: actionValue(r.video_p75_watched_actions),
        });
        currency = (r.account_currency as string) || currency;
      }
    }

    return {
      actId: account.act_id,
      accountName: account.account_name,
      currency,
      byAdId,
      totalSpend: somaTotais.spend,
      totalImpressions: somaTotais.impressions,
      totalLinkClicks: somaTotais.linkClicks,
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

// ── Porta de entrada por anúncio (cache por ANÚNCIO, 6h) ───────────────────
// Alimenta o filtro "Entrada" do dash. O cache é por anúncio, não por
// requisição: entrada é CONFIGURAÇÃO do anúncio (destino do conjunto +
// mensagem de boas-vindas), não métrica — não muda com o período nem com o
// dia. Em regime o dash não faz chamada nenhuma aqui; só anúncio novo custa.
const entradaCache = new Map<string, { ts: number; entrada: EntradaLead | null }>();
const ENTRADA_TTL = 6 * 60 * 60_000;

/**
 * Mapa id_anuncio → porta de entrada, pros anúncios pedidos.
 * null (o retorno inteiro) = sem conta Meta / flag off / sem token: o dash
 * simplesmente não oferece o filtro. Anúncio que a Meta não classifica vem
 * com valor null DENTRO do mapa — é diferente de não saber quem ele é.
 */
// Orçamento desta busca. Diferente da camada de custo, que renderiza depois,
// esta roda ANTES de dimensões e filtros — ou seja, no caminho crítico da
// página. Meta lenta não pode pendurar o dash: estourou, devolve o que já
// está em cache (ou null) e o seletor some nesse render.
const ENTRADA_DEADLINE_MS = 4_000;

export async function getEntradaPorAnuncio(
  workspaceId: string,
  adIds: string[],
): Promise<Map<string, EntradaLead | null> | null> {
  if (!isMetaAdsEnabled()) return null;
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) return null;

  const ids = [...new Set(adIds.map((s) => s.trim()).filter((s) => /^\d{5,25}$/.test(s)))];
  if (ids.length === 0) return null;

  const account = await getAccountForWorkspace(workspaceId);
  if (!account) return null;

  const agora = Date.now();
  const out = new Map<string, EntradaLead | null>();
  const faltando: string[] = [];
  for (const id of ids) {
    const hit = entradaCache.get(id);
    if (hit && agora - hit.ts < ENTRADA_TTL) out.set(id, hit.entrada);
    else faltando.push(id);
  }
  if (faltando.length === 0) return out;

  try {
    const buscar = (async () => {
      // Mesma chamada que já traz miniatura/formato: devolve adset_id e a
      // mensagem de boas-vindas de quebra.
      const criativos = await fetchCreativeThumbs(faltando, token);
      const adsets = [...new Set([...criativos.values()].map((c) => c.adsetId).filter(Boolean))];
      const destinos = adsets.length
        ? await fetchDestinationTypes(adsets as string[], token)
        : new Map<string, string | null>();

      for (const id of faltando) {
        const c = criativos.get(id);
        const dest = c?.adsetId ? destinos.get(c.adsetId) ?? null : null;
        const entrada = classificarEntrada(dest, c);
        entradaCache.set(id, { ts: agora, entrada });
        out.set(id, entrada);
      }
      return true;
    })();

    const noPrazo = await Promise.race([
      buscar,
      new Promise<false>((r) => setTimeout(() => r(false), ENTRADA_DEADLINE_MS)),
    ]);
    if (!noPrazo) {
      // A promise segue rodando e ainda popula o cache pro próximo render —
      // só não seguramos a página esperando por ela.
      console.warn("[meta-ads] entrada por anúncio estourou o prazo", {
        workspaceId,
        faltando: faltando.length,
      });
      return out.size > 0 ? out : null;
    }
  } catch (e) {
    // Degrada: devolve o que já tinha em cache. Filtro some ou fica parcial,
    // o dash não cai.
    console.error("[meta-ads] entrada por anúncio falhou", {
      workspaceId,
      error: e instanceof Error ? e.message : String(e),
    });
    if (out.size === 0) return null;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// Canal interno pro Aton Core (motor de saúde do assinante / relatório gpt).
//
// Por que uma função separada de getMetaAdsForWorkspace: aquela FILTRA os ads
// que têm lead na base (otimização de render do dash). Aqui é o oposto — o
// Core precisa justamente dos anúncios com gasto e ZERO lead ("R$ 867 dos
// R$ 1.351 foram pra anúncios sem MQL"), então a varredura é SEM filtro.
// Custo aceitável: 1-2 chamadas/dia em cron, janela ≤90 dias (a conta grande
// tinha 487 ads no histórico mas só 41 em 30d).
//
// O token da Meta fica SÓ aqui — o Core consome este endpoint e nunca vê o
// segredo. Somente leitura.
// ══════════════════════════════════════════════════════════════════════════

export type CoreAdInsight = {
  /** CRU, exatamente como a Meta devolve — é a chave do cruzamento com
   *  terrace360_leads_atonhub.id_anuncio no Core. Nunca formatar/truncar. */
  ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  /** Estrutura — vem do próprio Insights, sem chamada extra. null quando a
   *  Meta omite (objeto apagado depois de gastar). */
  campaign_id: string | null;
  adset_id: string | null;
  adset_name: string | null;
  spend: number;
  impressions: number;
  /** Cliques TOTAIS (campo `clicks`: inclui reação, comentário, perfil). */
  clicks: number;
  /** Cliques NO LINK (`inline_link_clicks`) — base do ctr/cpc abaixo. */
  link_clicks: number;
  /** CTR do LINK em % (mesma métrica do dash, pra relatório não contradizer
   *  a tela). Cliques no link ÷ impressões. */
  ctr: number;
  /** Custo por clique NO LINK. */
  cpc: number;
  cpm: number;
  /** Leads/CPL REPORTADOS PELA META — frequentemente errôneos (por isso não
   *  aparecem no dash). Mantidos só como referência; a contagem de verdade é
   *  a da base Aton, que o Core já cruza por ad_id. */
  meta_leads: number;
  meta_cpl: number | null;
  // ── Retenção de vídeo (metodologia Richard) ──────────────────────────────
  // É vídeo quando video_plays > 0. Nos outros formatos as taxas vêm null (e
  // não 0, que o Core leria como "retenção zero" num anúncio que nem é vídeo).
  /** Reproduções do vídeo (1º frame). Base das duas taxas. */
  video_plays: number;
  /** Reproduções de ≥3s — quem passou do hook. Vem do action_type
   *  `video_view`: video_3_sec_watched_actions foi REMOVIDO na v21 e o
   *  continuous_2_sec volta zerado em parte dos anúncios. */
  video_views_3s: number;
  /** Reproduções de 75% — quem consumiu a mensagem de venda. */
  video_p75: number;
  /** video_plays ÷ impressions (%). Pode passar de 100%: a Meta conta
   *  replays. Meta de referência: >90%. */
  video_play_rate: number | null;
  /** video_views_3s ÷ video_plays (%). O KPI mais acionável do conjunto.
   *  Meta Richard: 40-50% (mediana real da carteira Aton: ~26%). */
  video_ret_hook: number | null;
  /** video_p75 ÷ video_plays (%). Meta: >2% (p25 real da carteira: 1,9%). */
  video_ret_body: number | null;
  /** Por qual porta o lead entra — ver EntradaLead em meta-ads-kpi.ts.
   *  null = a Meta não permite afirmar (vídeo, perfil, conjunto apagado) ou
   *  o anúncio não é de captação. Nunca chutar: vira frase no relatório. */
  entrada: EntradaLead | null;
  /** Valor CRU do destination_type do conjunto — ON_AD, WHATSAPP, ON_VIDEO,
   *  INSTAGRAM_PROFILE, MESSENGER, UNDEFINED… Vai junto com o traduzido de
   *  propósito: valor novo da Meta aparece aqui sem depender de deploy. */
  destination_type: string | null;
  /** Miniatura 256px do criativo (mesma que o dash mostra) — o Pulso do Core
   *  a exibe nas telas de criativos/retenção pra o assinante reconhecer a
   *  peça de bater o olho. null quando a Meta não devolve (best-effort). */
  thumbnail_url: string | null;
  /** Plataforma REALIZADA (breakdowns=publisher_platform): onde a verba
   *  efetivamente entregou. null = a chamada de breakdown falhou ("não
   *  sei"); [] = a Meta respondeu e não houve entrega no período. */
  por_plataforma: CorePlatformSplit[] | null;
};

/** Split por plataforma. `platform` vai CRU como a Meta devolve — facebook,
 *  instagram, audience_network, messenger, threads, whatsapp… — sem
 *  allowlist, senão uma plataforma nova sumiria do relatório calada. */
export type CorePlatformSplit = {
  platform: string;
  spend: number;
  impressions: number;
};

export type CoreAdset = {
  adset_id: string;
  adset_name: string | null;
  /** ⚠️ JÁ CONVERTIDO de centavos pra MOEDA — mesma escala de `spend`
   *  (a Meta devolve orçamento na unidade mínima: 6000 = R$ 60,00).
   *  null = não se aplica (orçamento está na campanha, CBO) ou desconhecido.
   *  Nunca 0. */
  daily_budget: number | null;
  lifetime_budget: number | null;
  /** Posicionamento CONFIGURADO no targeting. ⚠️ null = placements
   *  AUTOMÁTICOS (a Meta não devolve o campo nesse caso), ou seja TODAS as
   *  plataformas elegíveis — não "nenhuma". Medido na carteira em
   *  17/09/2026: Brows 167/214 conjuntos com placement manual, Emive e Sá
   *  Cavalcante 0 (tudo automático). Compare com o REALIZADO em
   *  por_anuncio[].por_plataforma. */
  publisher_platforms: string[] | null;
};

export type CoreCampaign = {
  campaign_id: string;
  campaign_name: string | null;
  /** Mesma unidade/regra de null do conjunto. Orçamento vive na campanha
   *  (CBO) OU no conjunto — por isso os dois níveis vêm, com null onde não
   *  se aplica, em vez de a gente escolher um. */
  daily_budget: number | null;
  lifetime_budget: number | null;
  conjuntos: CoreAdset[];
};

export type CoreMetaInsights = {
  workspace_id: string;
  act_id: string;
  account_name: string | null;
  moeda: string;
  periodo: { de: string; ate: string; dias: number };
  /** Soma dos anúncios do período — fecha a aritmética com `por_anuncio`
   *  (spend de A + B + ... = total.spend), o que sustenta afirmações do tipo
   *  "X dos Y reais foram pra anúncios sem MQL". */
  total: {
    spend: number;
    impressions: number;
    clicks: number;
    link_clicks: number;
    ctr: number;
    cpc: number;
    meta_leads: number;
    /** Agregados de vídeo: SOMAS das bases, e as taxas calculadas sobre elas
     *  (não média de taxas — isso daria peso igual a um vídeo de 200 e outro
     *  de 200 mil reproduções). Só considera os anúncios de formato vídeo. */
    video_plays: number;
    video_views_3s: number;
    video_p75: number;
    video_ret_hook: number | null;
    video_ret_body: number | null;
    /** Mix de plataforma da CONTA no período (soma dos anúncios). null = a
     *  chamada de breakdown falhou. */
    por_plataforma: CorePlatformSplit[] | null;
  };
  por_anuncio: CoreAdInsight[];
  /** Estrutura + orçamento das campanhas que tiveram entrega no período.
   *  Montada a partir dos ANÚNCIOS (não do edge /campaigns): campanha ou
   *  conjunto apagado depois de gastar continua aparecendo, só com
   *  orçamento null. Campanha sem entrega no período não entra — o
   *  relatório fala do período. */
  campanhas: CoreCampaign[];
  /** true = veio de cache OU a chamada à Meta falhou e servimos o último
   *  valor conhecido. NUNCA devolvemos zero silencioso (ver rota: falha sem
   *  cache = 502, não payload zerado). */
  stale: boolean;
  /** ISO de quando os dados foram puxados da Meta (não de agora). */
  fetched_at: string;
};

// Cache dedicado (shape/período diferentes do usado no dash). Mantém o último
// valor conhecido INDEFINIDAMENTE pro fallback de falha — só o `stale` muda.
const coreCache = new Map<string, { ts: number; data: CoreMetaInsights }>();
const CORE_TTL = 15 * 60_000;
const CORE_MAX_PAGES = 20;

const round2c = (n: number) => Math.round(n * 100) / 100;

/** Últimos N dias em UTC, inclusive hoje — idêntico ao resolvePeriod("7d"/
 *  "14d"/"30d") do dash, pra Core e tela falarem do mesmo intervalo. */
function lastNDaysRange(days: number, until?: string): { de: string; ate: string } {
  const isoDay = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate(),
    ).padStart(2, "0")}`;
  // until valido e nao-futuro vira o fim do periodo; qualquer outra coisa cai
  // no comportamento antigo (hoje) — o chamador legado nao muda.
  const now = new Date();
  let end = now;
  if (until && /^\d{4}-\d{2}-\d{2}$/.test(until)) {
    const parsed = new Date(`${until}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed <= now) end = parsed;
  }
  const from = new Date(end);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { de: isoDay(from), ate: isoDay(end) };
}

export type CoreLookupResult =
  | { ok: true; data: CoreMetaInsights }
  | { ok: false; reason: "not_mapped" | "no_token" | "upstream_failed" };

/**
 * Insights de mídia por anúncio pro Core. Nunca zera silenciosamente:
 * - conta não cadastrada/desabilitada → not_mapped (rota devolve 404)
 * - Meta falhou e não há cache        → upstream_failed (rota devolve 502)
 * - Meta falhou mas há cache          → ok + stale: true (último conhecido)
 */
export async function getMetaInsightsForCore(
  workspaceId: string,
  days: number,
  /** Fim do período (YYYY-MM-DD, inclusivo). Sem ele, hoje — mas o Core usa a
   *  janela ASSENTADA de leads (termina D-2): sem este parâmetro, verba e
   *  leads do mesmo relatório cobriam períodos defasados em ~3 dias. */
  until?: string,
): Promise<CoreLookupResult> {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) return { ok: false, reason: "no_token" };

  const account = await getAccountForWorkspace(workspaceId);
  if (!account) return { ok: false, reason: "not_mapped" };

  const { de, ate } = lastNDaysRange(days, until);
  const cacheKey = `${account.act_id}|${de}|${ate}`;
  const cached = coreCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < CORE_TTL) {
    return { ok: true, data: { ...cached.data, stale: true } };
  }

  const fields =
    "ad_id,ad_name,campaign_name,campaign_id,adset_id,adset_name," +
    "spend,impressions,clicks,inline_link_clicks," +
    "inline_link_click_ctr,cost_per_inline_link_click,cpm,actions,cost_per_action_type," +
    "account_currency,video_play_actions,video_p75_watched_actions";
  const timeRange = encodeURIComponent(JSON.stringify({ since: de, until: ate }));
  const base = `https://graph.facebook.com/v21.0/${account.act_id}`;
  const tokenParam = `access_token=${encodeURIComponent(token)}`;
  let url: string | null =
    `${base}/insights?level=ad&time_range=${timeRange}&fields=${fields}&limit=200&${tokenParam}`;

  const porAnuncio: CoreAdInsight[] = [];
  let moeda = "BRL";
  let failed = false;

  for (let page = 0; url && page < CORE_MAX_PAGES; page++) {
    const json = await fetchJson(url);
    if (!json || json.error) {
      failed = true;
      break;
    }
    for (const r of (json.data as Array<Record<string, unknown>> | undefined) ?? []) {
      const adId = String(r.ad_id ?? "").trim();
      if (!adId) continue;
      const actions = r.actions as Array<{ action_type?: string; value?: string }> | undefined;
      const cpa = r.cost_per_action_type as
        | Array<{ action_type?: string; value?: string }>
        | undefined;
      moeda = (r.account_currency as string) || moeda;
      const cplRaw = pickCoreLead(cpa);
      const impressions = num(r.impressions);
      const plays = actionValue(r.video_play_actions);
      const views3s = pickActionType(r.actions, "video_view");
      const p75 = actionValue(r.video_p75_watched_actions);
      porAnuncio.push({
        ad_id: adId,
        ad_name: (r.ad_name as string) ?? null,
        campaign_name: (r.campaign_name as string) ?? null,
        campaign_id: (r.campaign_id as string) ?? null,
        adset_id: (r.adset_id as string) ?? null,
        adset_name: (r.adset_name as string) ?? null,
        // Crus e exatos (spend/impressions/clicks/link_clicks/meta_leads) —
        // é com eles que o Core recalcula o que precisa. Só as métricas de
        // conveniência (ctr/cpc/cpm/cpl) vão arredondadas a 2 casas.
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        link_clicks: num(r.inline_link_clicks),
        ctr: round2c(num(r.inline_link_click_ctr)),
        cpc: round2c(num(r.cost_per_inline_link_click)),
        cpm: round2c(num(r.cpm)),
        meta_leads: pickCoreLead(actions) ?? 0,
        meta_cpl: cplRaw === null ? null : round2c(cplRaw),
        // Vídeo: bases cruas + taxas. Taxa null quando não há reprodução
        // (imagem/carrossel) — melhor que 0, que o Core leria como "retenção
        // zero" num anúncio que nem é vídeo.
        video_plays: plays,
        video_views_3s: views3s,
        video_p75: p75,
        video_play_rate: impressions > 0 && plays > 0 ? round2c((plays / impressions) * 100) : null,
        video_ret_hook: plays > 0 ? round2c((views3s / plays) * 100) : null,
        video_ret_body: plays > 0 ? round2c((p75 / plays) * 100) : null,
        thumbnail_url: null,
        por_plataforma: null,
        entrada: null,
        destination_type: null,
      });
    }
    url = (json.paging as { next?: string } | undefined)?.next ?? null;
  }

  if (failed) {
    // Serve o último conhecido marcado como stale; sem cache → erro explícito.
    if (cached) return { ok: true, data: { ...cached.data, stale: true } };
    return { ok: false, reason: "upstream_failed" };
  }

  // ── Extras do Pulso: plataforma REALIZADA + estrutura/orçamento ─────────
  // 3 chamadas FIXAS por conta, em paralelo — nunca 1+N (puxar targeting
  // anúncio a anúncio estoura limite de taxa). Medido na carteira inteira em
  // 17/09/2026: a maior conta (Brows) devolve 46 linhas de breakdown, 55
  // campanhas e 214 conjuntos — tudo numa página só, e as 15 contas
  // respondem sem erro de permissão.
  // Falha aqui NÃO derruba o endpoint: vira null (= "não sei"), distinto de
  // [] (= "a Meta respondeu e não havia nada").
  const extrasP = Promise.all([
    fetchAllPages(
      `${base}/insights?level=ad&time_range=${timeRange}` +
        `&breakdowns=publisher_platform&fields=ad_id,spend,impressions&limit=500&${tokenParam}`,
    ),
    fetchAllPages(`${base}/campaigns?fields=id,name,daily_budget,lifetime_budget&limit=500&${tokenParam}`),
    fetchAllPages(
      `${base}/adsets?fields=id,name,campaign_id,daily_budget,lifetime_budget,` +
        `destination_type,targeting{publisher_platforms}&limit=500&${tokenParam}`,
    ),
  ]);

  // Miniaturas (best-effort, mesmo buscador do dash): falha vira null — a
  // tabela do Pulso degrada pro placeholder, nunca derruba o dado de custo.
  // A mesma chamada traz miniatura E o sinal de formulário-no-WhatsApp.
  let criativos = new Map<string, CreativeMeta>();
  if (porAnuncio.length) {
    try {
      criativos = await fetchCreativeThumbs(porAnuncio.map((a) => a.ad_id), token);
      for (const a of porAnuncio) a.thumbnail_url = criativos.get(a.ad_id)?.thumb ?? null;
    } catch {
      /* cosmético — segue sem thumb nem classificação de entrada */
    }
  }

  const [platRows, campRows, adsetRows] = await extrasP;
  if (!platRows) console.error("[meta-ads] breakdown de plataforma falhou", { actId: account.act_id });
  if (!campRows || !adsetRows) console.error("[meta-ads] estrutura/orçamento falhou", { actId: account.act_id });

  // Plataforma realizada: por anúncio e somada na conta.
  let porPlataformaTotal: CorePlatformSplit[] | null = null;
  if (platRows) {
    const byAd = new Map<string, CorePlatformSplit[]>();
    const somaPlat = new Map<string, { spend: number; impressions: number }>();
    for (const r of platRows) {
      const adId = String(r.ad_id ?? "").trim();
      const platform = String(r.publisher_platform ?? "").trim();
      if (!adId || !platform) continue;
      const spend = num(r.spend);
      const impressions = num(r.impressions);
      const lista = byAd.get(adId) ?? [];
      lista.push({ platform, spend: round2c(spend), impressions });
      byAd.set(adId, lista);
      const t = somaPlat.get(platform) ?? { spend: 0, impressions: 0 };
      somaPlat.set(platform, { spend: t.spend + spend, impressions: t.impressions + impressions });
    }
    for (const a of porAnuncio) {
      a.por_plataforma = (byAd.get(a.ad_id) ?? []).sort((x, y) => y.spend - x.spend);
    }
    porPlataformaTotal = [...somaPlat]
      .map(([platform, v]) => ({ platform, spend: round2c(v.spend), impressions: v.impressions }))
      .sort((a, b) => b.spend - a.spend);
  }

  // Estrutura: a árvore vem dos ANÚNCIOS (autoritativa pro período); os
  // edges só enriquecem com orçamento e placement configurado.
  const orcCampanha = new Map<
    string,
    { daily: number | null; lifetime: number | null; name: string | null }
  >();
  for (const c of campRows ?? []) {
    const id = String(c.id ?? "").trim();
    if (!id) continue;
    orcCampanha.set(id, {
      daily: budgetToMajor(c.daily_budget),
      lifetime: budgetToMajor(c.lifetime_budget),
      name: (c.name as string) ?? null,
    });
  }
  const destinoConjunto = new Map<string, string | null>();
  const orcConjunto = new Map<
    string,
    { daily: number | null; lifetime: number | null; platforms: string[] | null }
  >();
  for (const s of adsetRows ?? []) {
    const id = String(s.id ?? "").trim();
    if (!id) continue;
    const alvo = s.targeting as { publisher_platforms?: unknown } | undefined;
    const plats = Array.isArray(alvo?.publisher_platforms)
      ? (alvo.publisher_platforms as unknown[]).map((p) => String(p))
      : null;
    orcConjunto.set(id, {
      daily: budgetToMajor(s.daily_budget),
      lifetime: budgetToMajor(s.lifetime_budget),
      platforms: plats,
    });
    destinoConjunto.set(id, (s.destination_type as string) ?? null);
  }

  // Entrada do lead: destino do conjunto + mensagem de boas-vindas do
  // criativo. Conjunto que a Meta não devolveu (apagado) fica null nos dois
  // campos — "não sei", que o Core trata diferente de "não tem".
  for (const a of porAnuncio) {
    const dest = a.adset_id ? destinoConjunto.get(a.adset_id) ?? null : null;
    a.destination_type = dest;
    a.entrada = classificarEntrada(dest, criativos.get(a.ad_id));
  }

  const campMap = new Map<string, CoreCampaign>();
  const conjuntosVistos = new Set<string>();
  for (const a of porAnuncio) {
    if (!a.campaign_id) continue;
    let camp = campMap.get(a.campaign_id);
    if (!camp) {
      const o = orcCampanha.get(a.campaign_id);
      camp = {
        campaign_id: a.campaign_id,
        campaign_name: a.campaign_name ?? o?.name ?? null,
        daily_budget: o?.daily ?? null,
        lifetime_budget: o?.lifetime ?? null,
        conjuntos: [],
      };
      campMap.set(a.campaign_id, camp);
    }
    if (a.adset_id && !conjuntosVistos.has(a.adset_id)) {
      conjuntosVistos.add(a.adset_id);
      const o = orcConjunto.get(a.adset_id);
      camp.conjuntos.push({
        adset_id: a.adset_id,
        adset_name: a.adset_name,
        daily_budget: o?.daily ?? null,
        lifetime_budget: o?.lifetime ?? null,
        publisher_platforms: o?.platforms ?? null,
      });
    }
  }
  const campanhas = [...campMap.values()];

  const total = porAnuncio.reduce(
    (acc, a) => ({
      spend: acc.spend + a.spend,
      impressions: acc.impressions + a.impressions,
      clicks: acc.clicks + a.clicks,
      link_clicks: acc.link_clicks + a.link_clicks,
      meta_leads: acc.meta_leads + a.meta_leads,
      video_plays: acc.video_plays + a.video_plays,
      video_views_3s: acc.video_views_3s + a.video_views_3s,
      video_p75: acc.video_p75 + a.video_p75,
    }),
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      link_clicks: 0,
      meta_leads: 0,
      video_plays: 0,
      video_views_3s: 0,
      video_p75: 0,
    },
  );

  const round2 = round2c;
  const data: CoreMetaInsights = {
    workspace_id: workspaceId,
    act_id: account.act_id,
    account_name: account.account_name,
    moeda,
    periodo: { de, ate, dias: days },
    total: {
      spend: round2(total.spend),
      impressions: total.impressions,
      clicks: total.clicks,
      link_clicks: total.link_clicks,
      ctr: total.impressions > 0 ? round2((total.link_clicks / total.impressions) * 100) : 0,
      cpc: total.link_clicks > 0 ? round2(total.spend / total.link_clicks) : 0,
      meta_leads: total.meta_leads,
      video_plays: total.video_plays,
      video_views_3s: total.video_views_3s,
      video_p75: total.video_p75,
      video_ret_hook:
        total.video_plays > 0 ? round2((total.video_views_3s / total.video_plays) * 100) : null,
      video_ret_body:
        total.video_plays > 0 ? round2((total.video_p75 / total.video_plays) * 100) : null,
      por_plataforma: porPlataformaTotal,
    },
    por_anuncio: porAnuncio.sort((a, b) => b.spend - a.spend),
    campanhas,
    stale: false,
    fetched_at: new Date().toISOString(),
  };

  coreCache.set(cacheKey, { ts: now, data });
  return { ok: true, data };
}

/** Percorre um edge da conta até acabar (com teto de páginas). null = a Meta
 *  falhou — quem chama degrada pra null, nunca inventa lista vazia. */
async function fetchAllPages(url: string): Promise<Array<Record<string, unknown>> | null> {
  const out: Array<Record<string, unknown>> = [];
  let next: string | null = url;
  for (let page = 0; next && page < CORE_MAX_PAGES; page++) {
    const json: Record<string, unknown> | null = await fetchJson(next);
    if (!json || json.error) return null;
    out.push(...((json.data as Array<Record<string, unknown>> | undefined) ?? []));
    next = (json.paging as { next?: string } | undefined)?.next ?? null;
  }
  return out;
}

/** Orçamento da Meta vem na unidade MÍNIMA da moeda (6000 = R$ 60,00).
 *  Converte pra a mesma escala do spend. Ausente ou "0" (conjunto sob CBO)
 *  vira null: zero aqui não é "orçamento zero", é "não se aplica" — e o
 *  relatório leria 0 como informação. */
function budgetToMajor(v: unknown): number | null {
  const n = num(v);
  return n > 0 ? round2c(n / 100) : null;
}

// action_types que a Meta usa pra lead (ordem de preferência). Só pro campo
// meta_leads/meta_cpl de referência — não alimenta nada do dash.
const CORE_LEAD_ACTIONS = ["onsite_conversion.lead_grouped", "leadgen_grouped", "lead"];

function pickCoreLead(
  list: Array<{ action_type?: string; value?: string }> | undefined,
): number | null {
  if (!Array.isArray(list)) return null;
  for (const t of CORE_LEAD_ACTIONS) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return null;
}

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
      a.impressions,
      a.linkClicks,
      a.plays,
      a.views3s,
      a.p75,
      a.duracaoSeg,
    ];
  }
  return {
    currency: d.currency,
    totalSpend: d.totalSpend,
    // CTR/CPC de LINK ponderados pela conta (cliques no link ÷ impressões).
    avgCtr: d.totalImpressions > 0 ? (d.totalLinkClicks / d.totalImpressions) * 100 : 0,
    avgCpc: d.totalLinkClicks > 0 ? d.totalSpend / d.totalLinkClicks : 0,
    avgCpm: d.totalImpressions > 0 ? (d.totalSpend / d.totalImpressions) * 1000 : 0,
    ads,
  };
}
