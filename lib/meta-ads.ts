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
  /* Conjunto com mais de um destino de mensagem também leva ao WhatsApp:
     MESSAGING_INSTAGRAM_DIRECT_WHATSAPP (e variações MESSAGING_*_WHATSAPP).
     A campanha "Set 2026 Whatsapp" da EMIVE é assim, e os 19 leads e a venda
     dela caíam em "Sem anúncio rastreado" (Rafaela, 02/10/2026). */
  if (destinationType === "WHATSAPP" || (destinationType?.startsWith("MESSAGING_") && destinationType.includes("WHATSAPP"))) {
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
  // ── Ampliação de 09/10/2026 (auditoria do Bastidor) ─────────────────────
  // O Core dividia a verba pelas pessoas do CRM (R$ 15/pessoa) quando o custo
  // real na Meta era ~R$ 10 por conversa, e chamava de "time olhando" uma
  // campanha parada por saldo ou pausada à mão. Estes campos dão o dado cru.
  /** Pessoas únicas alcançadas no período. NÃO somar entre anúncios (há
   *  sobreposição); por isso não existe reach no `total`. */
  reach: number;
  /** impressions ÷ reach. null sem alcance. */
  frequency: number | null;
  /** action onsite_conversion.messaging_conversation_started_7d: conversas
   *  iniciadas no WhatsApp/Messenger/Direct atribuídas ao anúncio. */
  conversas_iniciadas: number;
  /** spend ÷ conversas_iniciadas. null quando não houve conversa. */
  custo_por_conversa: number | null;
  /** Leads de formulário instantâneo reportados pela Meta. Mesmo valor de
   *  meta_leads, com nome explícito. */
  leads_formulario: number;
  /** Reproduções que chegaram a 25/50/100% e ThruPlay (15s ou o vídeo todo). */
  video_p25: number;
  video_p50: number;
  video_p100: number;
  video_thruplay: number;
  /** Tempo médio assistido, em segundos. null quando não é vídeo. */
  video_tempo_medio_seg: number | null;
  /** Status do anúncio AGORA (não do período): ACTIVE, PAUSED,
   *  CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED, WITH_ISSUES... effective
   *  herda a pausa de cima; configured é o que está marcado no próprio
   *  anúncio. null = a Meta não respondeu. */
  effective_status: string | null;
  configured_status: string | null;
  /** Título e texto do criativo. null quando o criativo não tem (dinâmico). */
  criativo_titulo: string | null;
  criativo_texto: string | null;
};

/** Uma alteração feita na conta (GET /act_x/activities), últimos 7 dias. Só
 *  status, orçamento, criação e edição de anúncio. Responde "quem pausou e
 *  quando". actor_name "Meta" = ação automática da plataforma. */
export type CoreAtividade = {
  event_type: string;
  event_time: string;
  object_id: string | null;
  object_name: string | null;
  actor_name: string | null;
  /** JSON da Meta já parseado quando possível (old_value, new_value,
   *  campaign_id...); string crua quando não parseia. */
  extra_data: unknown;
};

export type CoreRecorteRegiao = {
  region: string;
  spend: number;
  impressions: number;
  /** null: a Meta NÃO devolve conversas no recorte por região (medido em
   *  09/10/2026: zero linhas com a action). Não é zero conversa. */
  conversas: number | null;
};

export type CoreRecortePosicao = {
  publisher_platform: string;
  platform_position: string;
  spend: number;
  impressions: number;
  link_clicks: number;
  conversas: number | null;
};

export type CoreRecorteIdadeGenero = {
  age: string;
  gender: string;
  spend: number;
  conversas: number | null;
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
  /** Status AGORA e última alteração (ISO da Meta). null = não devolvido. */
  effective_status: string | null;
  configured_status: string | null;
  updated_time: string | null;
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
  effective_status: string | null;
  configured_status: string | null;
  updated_time: string | null;
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
    /** Soma das conversas iniciadas dos anúncios e o custo médio por conversa
     *  (total.spend ÷ conversas). É ESTE o custo por contato, não verba ÷
     *  pessoas do CRM. */
    conversas_iniciadas: number;
    custo_por_conversa: number | null;
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
  /** Situação da conta AGORA (não do período): saldo de conta pré-paga, forma
   *  de pagamento e status. null = a Meta não respondeu. Pedido do Murillo
   *  (01/10/2026): antes de avisar "sem saldo", saber se a conta é pré-paga. */
  conta?: CoreContaStatus | null;
  /** Alterações na conta nos últimos 7 dias (fixo, independe de `days`). Só
   *  status, orçamento, criação e edição de anúncio. Em conta compartilhada,
   *  eventos de campanhas excluídas ficam de fora. null = a Meta não
   *  respondeu. */
  atividades?: CoreAtividade[] | null;
  /** Recortes do período, só das campanhas desta workspace. Cada um null
   *  quando a Meta não respondeu. */
  recortes?: {
    regiao: CoreRecorteRegiao[] | null;
    plataforma_posicao: CoreRecortePosicao[] | null;
    idade_genero: CoreRecorteIdadeGenero[] | null;
  };
  /** true = alguma chamada complementar bateu no limite de taxa da Meta
   *  (código 17 e afins) ou falhou, e o que faltou veio null. Os números principais
   *  (spend, anúncios) não são parciais: se eles falham, o endpoint dá 502
   *  ou serve o cache com stale. */
  parcial?: boolean;
  /** Estado de todas as campanhas não arquivadas da conta (sem as excluídas),
   *  inclusive as que não entregaram no período. */
  campanhas_status?: CoreCampanhaStatus[] | null;
  /** Entrega dia a dia: 7 dias completos até ontem + hoje (parcial_dia),
   *  fixo, não segue days/until. null = a Meta não respondeu. */
  entrega_diaria?: CoreEntregaCampanha[] | null;
};

export type CoreEntregaDia = {
  data: string;
  parcial_dia: boolean;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number | null;
  cpm: number | null;
  link_clicks: number;
  conversas_iniciadas: number;
  leads_formulario: number;
  anuncios_com_entrega: number | null;
};

export type CoreEntregaCampanha = {
  campaign_id: string;
  campaign_name: string | null;
  effective_status: string | null;
  /** Do CBO, ou a soma dos conjuntos que podem entregar (ACTIVE,
   *  WITH_ISSUES…). Em reais. null = só orçamento vitalício. */
  daily_budget: number | null;
  dias: CoreEntregaDia[];
};

type CoreStatusObj = {
  effective_status: string | null;
  configured_status: string | null;
  updated_time: string | null;
};

export type CoreCampanhaStatus = {
  campaign_id: string;
  campaign_name: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
} & CoreStatusObj;

/** Erros da Meta que são limite de taxa: devolvem parcial, não falha. */
const CODIGOS_LIMITE = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);

type CoreParcial<T> = { data: T | null; limite: boolean };

/** Como fetchJson, mas diz se a falha foi limite de taxa (o fetchJson perde
 *  o código do erro). */
async function coreFetch(url: string): Promise<{ json: Record<string, unknown> | null; limite: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json || json.error) {
      const code = Number((json?.error as { code?: unknown } | undefined)?.code);
      const limite = CODIGOS_LIMITE.has(code);
      console.error("[meta-ads] core extra !ok", { status: res.status, code, limite });
      return { json: null, limite };
    }
    return { json, limite: false };
  } catch (e) {
    console.error("[meta-ads] core extra falhou", { error: e instanceof Error ? e.message : String(e) });
    return { json: null, limite: false };
  } finally {
    clearTimeout(timer);
  }
}

async function coreGetPages(
  url: string,
  maxPages = CORE_MAX_PAGES,
): Promise<CoreParcial<Array<Record<string, unknown>>>> {
  const out: Array<Record<string, unknown>> = [];
  let next: string | null = url;
  for (let page = 0; next && page < maxPages; page++) {
    let r = await coreFetch(next);
    // Uma nova tentativa em falha que não é limite (timeout esporádico: a
    // /activities do Showa abortou uma vez em 12s e respondeu em 0,6s depois).
    if (!r.json && !r.limite) r = await coreFetch(next);
    if (!r.json) return { data: null, limite: r.limite };
    out.push(...((r.json.data as Array<Record<string, unknown>> | undefined) ?? []));
    next = (r.json.paging as { next?: string } | undefined)?.next ?? null;
  }
  return { data: out, limite: false };
}

type CoreAdInfo = {
  effective_status: string | null;
  configured_status: string | null;
  titulo: string | null;
  texto: string | null;
};

/** Status e texto do criativo por anúncio, em lotes de 50 via ?ids=. Lote que
 *  falha só deixa aqueles anúncios sem o dado. */
async function coreAdsInfo(ids: string[], token: string): Promise<CoreParcial<Map<string, CoreAdInfo>>> {
  const out = new Map<string, CoreAdInfo>();
  const unicos = [...new Set(ids.filter(Boolean))];
  let limite = false;
  const lotes: string[][] = [];
  for (let i = 0; i < unicos.length; i += 50) lotes.push(unicos.slice(i, i + 50));
  await Promise.all(
    lotes.map(async (lote) => {
      const r = await coreFetch(
        `https://graph.facebook.com/v21.0/?ids=${lote.join(",")}` +
          `&fields=effective_status,configured_status,creative{title,body}` +
          `&access_token=${encodeURIComponent(token)}`,
      );
      if (!r.json) {
        if (r.limite) limite = true;
        return;
      }
      for (const [id, v] of Object.entries(r.json)) {
        const o = v as Record<string, unknown>;
        const cr = (o.creative ?? {}) as Record<string, unknown>;
        out.set(id, {
          effective_status: (o.effective_status as string) ?? null,
          configured_status: (o.configured_status as string) ?? null,
          titulo: (cr.title as string) ?? null,
          texto: (cr.body as string) ?? null,
        });
      }
    }),
  );
  return { data: out, limite };
}

export type CoreContaStatus = {
  /** true = paga com saldo (para quando zera); false = cartão/boleto pós-pago. */
  pre_paga: boolean | null;
  /** Texto da Meta: "Saldo disponível (R$ 45,85)" ou "VISA *1234". */
  forma_pagamento: string | null;
  /** Saldo disponível em reais, lido do texto da Meta quando é pré-paga. */
  saldo_disponivel: number | null;
  /** 1 ativa, 2 desativada, 3 pendência de pagamento, 7 em análise, 9 em período de carência... */
  status_conta: number | null;
  /** Limite de gasto da conta e quanto já foi gasto nele (reais), quando há. */
  limite_gasto: number | null;
  gasto_no_limite: number | null;
  /** Motivo de desativação da Meta (0 = nenhum). */
  disable_reason: number | null;
  /** Campo `balance` da Meta em reais. ⚠️ Em conta PÓS-paga é o valor a
   *  pagar acumulado, não saldo; em pré-paga o saldo disponível confiável é
   *  `saldo_disponivel`. */
  balance: number | null;
  /** Total gasto pela conta na vida toda e limite de gasto da conta (reais).
   *  spend_cap null = sem limite. Quando amount_spent alcança spend_cap a
   *  conta PARA de entregar. Ex.: ERS em 09/10/2026, 2.635,51 de 2.635,51. */
  amount_spent: number | null;
  spend_cap: number | null;
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
  // A chave PRECISA ter a workspace e as exclusões: duas workspaces podem
  // compartilhar a mesma conta (Cincorp: Dolce Vitta 287257 e Showa 323753)
  // com recortes diferentes. Sem isso, a segunda recebia o payload da
  // primeira, inclusive com o workspace_id dela no corpo.
  const excluidasCore = new Set(
    (account.campanhas_excluidas ?? []).map(chaveCampanha).filter(Boolean),
  );
  const cacheKey =
    `${workspaceId}|${account.act_id}|${de}|${ate}|x:` +
    [...excluidasCore].sort().join("~");
  const cached = coreCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < CORE_TTL) {
    return { ok: true, data: { ...cached.data, stale: true } };
  }

  const fields =
    "ad_id,ad_name,campaign_name,campaign_id,adset_id,adset_name," +
    "spend,impressions,clicks,inline_link_clicks," +
    "inline_link_click_ctr,cost_per_inline_link_click,cpm,actions,cost_per_action_type," +
    "account_currency,video_play_actions,video_p75_watched_actions," +
    // Ampliação 09/10/2026: na MESMA chamada, sem request a mais.
    "reach,frequency,video_p25_watched_actions,video_p50_watched_actions," +
    "video_p100_watched_actions,video_thruplay_watched_actions,video_avg_time_watched_actions";
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
      const spendAd = num(r.spend);
      const conversas = pickActionType(r.actions, "onsite_conversion.messaging_conversation_started_7d");
      const reach = num(r.reach);
      const tempoMedio = actionValue(r.video_avg_time_watched_actions);
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
        reach,
        frequency: reach > 0 ? round2c(num(r.frequency) || impressions / reach) : null,
        conversas_iniciadas: conversas,
        custo_por_conversa: conversas > 0 ? round2c(spendAd / conversas) : null,
        leads_formulario: pickCoreLead(actions) ?? 0,
        video_p25: actionValue(r.video_p25_watched_actions),
        video_p50: actionValue(r.video_p50_watched_actions),
        video_p100: actionValue(r.video_p100_watched_actions),
        video_thruplay: actionValue(r.video_thruplay_watched_actions),
        video_tempo_medio_seg: plays > 0 ? tempoMedio : null,
        // preenchidos depois pela chamada de status/criativo
        effective_status: null,
        configured_status: null,
        criativo_titulo: null,
        criativo_texto: null,
      });
    }
    url = (json.paging as { next?: string } | undefined)?.next ?? null;
  }

  if (failed) {
    // Serve o último conhecido marcado como stale; sem cache → erro explícito.
    if (cached) return { ok: true, data: { ...cached.data, stale: true } };
    return { ok: false, reason: "upstream_failed" };
  }

  // Conta COMPARTILHADA: tira os anúncios das campanhas que não são do funil
  // desta workspace, com a mesma regra do painel (casa por campaign_id OU
  // campaign_name). Feito ANTES de miniaturas, plataforma, estrutura e total,
  // para tudo o que vem depois falar só do recorte desta workspace.
  if (excluidasCore.size > 0) {
    const mantidos = porAnuncio.filter(
      (a) =>
        !excluidasCore.has(chaveCampanha(a.campaign_id)) &&
        !excluidasCore.has(chaveCampanha(a.campaign_name)),
    );
    if (mantidos.length === porAnuncio.length) {
      console.warn("[meta-ads] core: exclusão de campanha não casou com nada", {
        workspaceId,
        actId: account.act_id,
      });
    }
    porAnuncio.length = 0;
    porAnuncio.push(...mantidos);
  }
  const adsDoRecorte = new Set(porAnuncio.map((a) => a.ad_id));

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
    fetchAllPages(
      `${base}/campaigns?fields=id,name,daily_budget,lifetime_budget,` +
        `effective_status,configured_status,updated_time&limit=500&${tokenParam}`,
    ),
    fetchAllPages(
      `${base}/adsets?fields=id,name,campaign_id,daily_budget,lifetime_budget,` +
        `destination_type,targeting{publisher_platforms},` +
        `effective_status,configured_status,updated_time&limit=500&${tokenParam}`,
    ),
  ]);

  // ── Ampliação 09/10/2026: status + texto do criativo, atividades e
  // recortes. Chamadas FIXAS por conta (5 + 1 a cada 50 anúncios), em
  // paralelo. Detectam limite de taxa (código 17 e afins): o que bater no
  // limite vem null e o payload sai com parcial: true. Os recortes são
  // level=campaign, para filtrar as campanhas excluídas da workspace.
  const recorte = (bd: string) =>
    coreGetPages(
      `${base}/insights?level=campaign&time_range=${timeRange}&breakdowns=${bd}` +
        `&fields=campaign_id,spend,impressions,inline_link_clicks,actions&limit=500&${tokenParam}`,
    );
  const desde7d = Math.floor(Date.now() / 1000) - 7 * 86_400;
  const novosP = Promise.all([
    coreAdsInfo(porAnuncio.map((a) => a.ad_id), token),
    coreGetPages(
      `${base}/activities?since=${desde7d}` +
        `&fields=event_type,event_time,object_id,object_name,actor_name,extra_data&limit=100&${tokenParam}`,
      5,
    ),
    recorte("region"),
    recorte("publisher_platform,platform_position"),
    recorte("age,gender"),
  ]);

  // ── Entrega diária (09/10/2026, pedido do Core para o Pulso enxergar
  // queda de entrega). Janela FIXA: 7 dias completos até ontem + hoje
  // parcial, independente de days/until. Datas no fuso de São Paulo (todas
  // as contas mapeadas são BRL/Brasil); a Meta devolve date_start no fuso da
  // conta. Duas chamadas: campanha × dia e anúncio × dia (só para contar
  // anúncios com impressão no dia; o filtro impressions > 0 corta o resto).
  const hojeSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const diasEntrega: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(`${hojeSP}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    diasEntrega.push(d.toISOString().slice(0, 10));
  }
  const janelaEntrega = encodeURIComponent(JSON.stringify({ since: diasEntrega[0], until: hojeSP }));
  const entregaP = Promise.all([
    coreGetPages(
      `${base}/insights?level=campaign&time_range=${janelaEntrega}&time_increment=1` +
        `&fields=campaign_id,campaign_name,spend,impressions,reach,frequency,cpm,inline_link_clicks,actions&limit=500&${tokenParam}`,
    ),
    coreGetPages(
      `${base}/insights?level=ad&time_range=${janelaEntrega}&time_increment=1` +
        `&filtering=${encodeURIComponent(JSON.stringify([{ field: "impressions", operator: "GREATER_THAN", value: 0 }]))}` +
        `&fields=ad_id,campaign_id,impressions&limit=500&${tokenParam}`,
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

  const contaP = fetchJson(
    `${base}?fields=is_prepay_account,funding_source_details,account_status,spend_cap,amount_spent,disable_reason,balance&${tokenParam}`,
  ).catch(() => null);
  const [platRows, campRows, adsetRows] = await extrasP;
  const contaJson = await contaP;
  let conta: CoreContaStatus | null = null;
  if (contaJson && !contaJson.error) {
    const fsd = contaJson.funding_source_details as { display_string?: string } | undefined;
    const forma = fsd?.display_string ?? null;
    const m = forma ? forma.match(/R\$\s*([\d.]+,\d{2})/) : null;
    const reais = (v: unknown) => (v === undefined || v === null || v === "" ? null : Math.round(Number(v)) / 100);
    const cap = reais(contaJson.spend_cap);
    conta = {
      pre_paga: typeof contaJson.is_prepay_account === "boolean" ? contaJson.is_prepay_account : null,
      forma_pagamento: forma,
      saldo_disponivel: m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null,
      status_conta: typeof contaJson.account_status === "number" ? contaJson.account_status : null,
      limite_gasto: cap && cap > 0 ? cap : null,
      gasto_no_limite: cap && cap > 0 ? reais(contaJson.amount_spent) : null,
      disable_reason: typeof contaJson.disable_reason === "number" ? contaJson.disable_reason : null,
      balance: reais(contaJson.balance),
      amount_spent: reais(contaJson.amount_spent),
      spend_cap: cap && cap > 0 ? cap : null,
    };
  }
  const [adsInfo, atvRes, regRes, posRes, ageRes] = await novosP;
  const [entCampRes, entAdRes] = await entregaP;
  // parcial = faltou algo complementar, por limite de taxa (código 17 e
  // afins) ou por falha/timeout. O campo que faltou vem null.
  const parcial = [adsInfo, atvRes, regRes, posRes, ageRes, entCampRes, entAdRes].some(
    (r) => r.limite || r.data === null,
  );

  // Status e texto do criativo por anúncio.
  for (const a of porAnuncio) {
    const info = adsInfo.data?.get(a.ad_id);
    if (!info) continue;
    a.effective_status = info.effective_status;
    a.configured_status = info.configured_status;
    a.criativo_titulo = info.titulo;
    a.criativo_texto = info.texto;
  }

  // Atividades: só status, orçamento, criação e edição de anúncio. Em conta
  // compartilhada, descarta evento de campanha excluída (o extra_data traz o
  // campaign_id). Pausa de campanha sem entrega no período aparece aqui
  // mesmo sem nenhum anúncio no por_anuncio, que é o caso do Showa.
  const TIPOS_ATIVIDADE =
    /run_status|budget|^create_(ad|ad_set|campaign|campaign_group)$|^update_ad_creative$|^update_ad$/;
  let atividades: CoreAtividade[] | null = null;
  if (atvRes.data) {
    atividades = [];
    for (const e of atvRes.data) {
      const tipo = String(e.event_type ?? "");
      if (!TIPOS_ATIVIDADE.test(tipo)) continue;
      let extra: unknown = e.extra_data ?? null;
      if (typeof extra === "string") {
        try {
          // IDs da Meta passam de 2^53: como número, o campaign_id perde os
          // últimos dígitos (…110605 vira …110610) e o filtro de exclusão
          // erra. Inteiros de 16+ dígitos viram string antes do parse.
          extra = JSON.parse(extra.replace(/(:\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));
        } catch {
          /* fica a string crua */
        }
      }
      const campId =
        extra && typeof extra === "object" && "campaign_id" in (extra as object)
          ? String((extra as { campaign_id: unknown }).campaign_id)
          : null;
      if (
        excluidasCore.size > 0 &&
        ((campId && excluidasCore.has(chaveCampanha(campId))) ||
          excluidasCore.has(chaveCampanha(String(e.object_id ?? ""))))
      ) {
        continue;
      }
      atividades.push({
        event_type: tipo,
        event_time: String(e.event_time ?? ""),
        object_id: e.object_id ? String(e.object_id) : null,
        object_name: (e.object_name as string) ?? null,
        actor_name: (e.actor_name as string) ?? null,
        extra_data: extra,
      });
    }
  }

  // Recortes: agrega as linhas por chave, sem as campanhas excluídas.
  // `conversas` fica null quando nenhuma linha trouxe a action (a Meta não a
  // devolve por região), para não virar "zero conversa".
  const ACAO_CONVERSA = "onsite_conversion.messaging_conversation_started_7d";
  function agrega<T>(
    linhas: Array<Record<string, unknown>> | null,
    chave: (r: Record<string, unknown>) => string,
    monta: (r: Record<string, unknown>) => T,
  ): Array<T & { spend: number; impressions: number; link_clicks: number; conversas: number | null }> | null {
    if (!linhas) return null;
    const m = new Map<string, { base: T; spend: number; impressions: number; link_clicks: number; conv: number; temConv: boolean }>();
    for (const r of linhas) {
      if (excluidasCore.size > 0 && excluidasCore.has(chaveCampanha(String(r.campaign_id ?? "")))) continue;
      const k = chave(r);
      const v = m.get(k) ?? { base: monta(r), spend: 0, impressions: 0, link_clicks: 0, conv: 0, temConv: false };
      v.spend += num(r.spend);
      v.impressions += num(r.impressions);
      v.link_clicks += num(r.inline_link_clicks);
      const lista = r.actions as Array<{ action_type?: string }> | undefined;
      if (Array.isArray(lista) && lista.some((x) => x.action_type === ACAO_CONVERSA)) v.temConv = true;
      v.conv += pickActionType(r.actions, ACAO_CONVERSA);
      m.set(k, v);
    }
    const algumaConv = [...m.values()].some((v) => v.temConv);
    return [...m.values()]
      .map((v) => ({
        ...v.base,
        spend: round2c(v.spend),
        impressions: v.impressions,
        link_clicks: v.link_clicks,
        conversas: algumaConv ? v.conv : null,
      }))
      .sort((a, b) => b.spend - a.spend);
  }
  const reg = agrega(regRes.data, (r) => String(r.region ?? ""), (r) => ({ region: String(r.region ?? "") }));
  const pos = agrega(
    posRes.data,
    (r) => `${r.publisher_platform}|${r.platform_position}`,
    (r) => ({ publisher_platform: String(r.publisher_platform ?? ""), platform_position: String(r.platform_position ?? "") }),
  );
  const ida = agrega(
    ageRes.data,
    (r) => `${r.age}|${r.gender}`,
    (r) => ({ age: String(r.age ?? ""), gender: String(r.gender ?? "") }),
  );
  const recortes = {
    regiao: reg ? reg.map(({ region, spend, impressions, conversas }) => ({ region, spend, impressions, conversas })) : null,
    plataforma_posicao: pos,
    idade_genero: ida ? ida.map(({ age, gender, spend, conversas }) => ({ age, gender, spend, conversas })) : null,
  };
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
      // O breakdown vem da conta inteira: só soma anúncio do recorte.
      if (!adsDoRecorte.has(adId)) continue;
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
    { daily: number | null; lifetime: number | null; name: string | null } & CoreStatusObj
  >();
  const statusObj = (o: Record<string, unknown>): CoreStatusObj => ({
    effective_status: (o.effective_status as string) ?? null,
    configured_status: (o.configured_status as string) ?? null,
    updated_time: (o.updated_time as string) ?? null,
  });
  for (const c of campRows ?? []) {
    const id = String(c.id ?? "").trim();
    if (!id) continue;
    orcCampanha.set(id, {
      daily: budgetToMajor(c.daily_budget),
      lifetime: budgetToMajor(c.lifetime_budget),
      name: (c.name as string) ?? null,
      ...statusObj(c),
    });
  }
  const destinoConjunto = new Map<string, string | null>();
  const orcConjunto = new Map<
    string,
    { daily: number | null; lifetime: number | null; platforms: string[] | null } & CoreStatusObj
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
      ...statusObj(s),
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
        effective_status: o?.effective_status ?? null,
        configured_status: o?.configured_status ?? null,
        updated_time: o?.updated_time ?? null,
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
        effective_status: o?.effective_status ?? null,
        configured_status: o?.configured_status ?? null,
        updated_time: o?.updated_time ?? null,
      });
    }
  }
  const campanhas = [...campMap.values()];

  // `campanhas` só lista o que entregou no período. Campanha pausada antes
  // do período (Showa, pausada pelo Pedro em 07/10) não aparece lá; esta
  // lista dá o estado de TODAS as campanhas não arquivadas da conta, sem as
  // excluídas da workspace. null = a Meta não devolveu as campanhas.
  const campanhasStatus: CoreCampanhaStatus[] | null = campRows
    ? campRows
        .filter((c) => {
          const id = String(c.id ?? "").trim();
          const st = String(c.effective_status ?? "");
          if (!id || st === "ARCHIVED" || st === "DELETED") return false;
          return !(excluidasCore.size > 0 && excluidasCore.has(chaveCampanha(id)));
        })
        .map((c) => {
          const id = String(c.id).trim();
          const o = orcCampanha.get(id);
          return {
            campaign_id: id,
            campaign_name: o?.name ?? null,
            daily_budget: o?.daily ?? null,
            lifetime_budget: o?.lifetime ?? null,
            effective_status: o?.effective_status ?? null,
            configured_status: o?.configured_status ?? null,
            updated_time: o?.updated_time ?? null,
          };
        })
    : null;

  // Entrega diária: campanhas ACTIVE ou que gastaram na janela, sem as
  // excluídas. Dia sem linha da Meta = sem entrega (a Meta omite zero), então
  // vira zeros; cpm/frequency ficam null sem impressão (não há o que dividir).
  let entregaDiaria: CoreEntregaCampanha[] | null = null;
  if (entCampRes.data) {
    const fora = (id: string) => excluidasCore.size > 0 && excluidasCore.has(chaveCampanha(id));
    const linhasPorCamp = new Map<string, Map<string, Record<string, unknown>>>();
    const nomeCamp = new Map<string, string>();
    for (const r of entCampRes.data) {
      const id = String(r.campaign_id ?? "").trim();
      if (!id || fora(id)) continue;
      nomeCamp.set(id, String(r.campaign_name ?? ""));
      const m = linhasPorCamp.get(id) ?? new Map();
      m.set(String(r.date_start ?? ""), r);
      linhasPorCamp.set(id, m);
    }
    // anúncios com impressão por campanha × dia
    const adsDia = new Map<string, Set<string>>();
    for (const r of entAdRes.data ?? []) {
      if (num(r.impressions) <= 0) continue;
      const k = `${r.campaign_id}|${r.date_start}`;
      const s = adsDia.get(k) ?? new Set<string>();
      s.add(String(r.ad_id));
      adsDia.set(k, s);
    }
    // orçamento diário: o da campanha (CBO) ou a soma dos conjuntos que
    // podem entregar. WITH_ISSUES entra: entrega com alerta da Meta (EMIVE
    // "Chachoeiro", 09/10: único conjunto ativo estava assim).
    const ENTREGAVEL = new Set(["ACTIVE", "WITH_ISSUES", "IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED"]);
    const somaConjuntos = new Map<string, number>();
    for (const s of adsetRows ?? []) {
      if (!ENTREGAVEL.has(String(s.effective_status ?? ""))) continue;
      const v = budgetToMajor(s.daily_budget);
      if (v === null) continue;
      const c = String(s.campaign_id ?? "");
      somaConjuntos.set(c, round2c((somaConjuntos.get(c) ?? 0) + v));
    }
    const ids = new Set<string>(linhasPorCamp.keys());
    for (const [id, o] of orcCampanha) {
      if ((o.effective_status === "ACTIVE" || o.effective_status === "WITH_ISSUES") && !fora(id)) ids.add(id);
    }
    entregaDiaria = [...ids].map((id) => {
      const o = orcCampanha.get(id);
      const linhas = linhasPorCamp.get(id);
      return {
        campaign_id: id,
        campaign_name: o?.name ?? nomeCamp.get(id) ?? null,
        effective_status: o?.effective_status ?? null,
        daily_budget: o?.daily ?? somaConjuntos.get(id) ?? null,
        dias: diasEntrega.map((data) => {
          const r = linhas?.get(data);
          const imp = r ? num(r.impressions) : 0;
          return {
            data,
            parcial_dia: data === hojeSP,
            spend: r ? round2c(num(r.spend)) : 0,
            impressions: imp,
            reach: r ? num(r.reach) : 0,
            frequency: imp > 0 ? round2c(num(r!.frequency)) : null,
            cpm: imp > 0 ? round2c(num(r!.cpm)) : null,
            link_clicks: r ? num(r.inline_link_clicks) : 0,
            conversas_iniciadas: r ? pickActionType(r.actions, ACAO_CONVERSA) : 0,
            leads_formulario: r ? pickCoreLead(r.actions as Array<{ action_type?: string; value?: string }>) ?? 0 : 0,
            // null = a chamada por anúncio falhou (não sei), não "zero anúncios"
            anuncios_com_entrega: entAdRes.data ? adsDia.get(`${id}|${data}`)?.size ?? 0 : null,
          };
        }),
      };
    });
    const gasto = (c: CoreEntregaCampanha) => c.dias.reduce((s, d) => s + d.spend, 0);
    entregaDiaria.sort((a, b) => gasto(b) - gasto(a));
  }

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
      conversas_iniciadas: acc.conversas_iniciadas + a.conversas_iniciadas,
    }),
    {
      conversas_iniciadas: 0,
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
      conversas_iniciadas: total.conversas_iniciadas,
      custo_por_conversa:
        total.conversas_iniciadas > 0 ? round2(total.spend / total.conversas_iniciadas) : null,
    },
    por_anuncio: porAnuncio.sort((a, b) => b.spend - a.spend),
    campanhas,
    stale: false,
    fetched_at: new Date().toISOString(),
    conta,
    campanhas_status: campanhasStatus,
    atividades,
    recortes,
    parcial,
    entrega_diaria: entregaDiaria,
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
