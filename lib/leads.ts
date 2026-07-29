import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import { classify, GRUPO_LABEL } from "./classify";
import {
  previousRange,
  type DateRange,
  type PeriodKey,
} from "./period";
import {
  applyFilters,
  computeDimensions,
  dropInvalidFilters,
  type Dimensions,
  type Filters,
} from "./filters";
import {
  buildAllCharts,
  buildMonthlyEvolution,
  type ChartsData,
  type MonthlyEvolutionPoint,
} from "./charts";
import { computeDelta, type Delta } from "./deltas";
import { getExcludedLeadIds } from "./lead-exclusions";

// Linha crua da terrace360_leads_atonhub — apenas as colunas que o dashboard
// consome. Demais colunas (probabilidade_avanco, dia_hora_semana, cliente,
// titulo_campanha) são ignoradas — não usadas até M5.
export type LeadRow = {
  id: number;
  data: string | null; // timestamptz ISO
  nome_lead: string | null;
  etapa_funil: string | null;
  resumo_conversa: string | null;
  telefone: string | null;
  ddd_lead: string | null;
  nome_campanha: string | null;
  id_anuncio: string | null;
  mql: string | null; // 'sim' | 'não' | null
  canal_campanha: string | null;
  cidade_campanha: string | null;
  estado_campanha: string | null;
};

export type Kpis = {
  total: number;
  interagiram: number;
  pctInteracao: number;
  mqlSim: number;
  /** mqlSim / total. Denominador é o TOTAL (não só os classificados): leads
   *  sem `mql` preenchido contam como não-MQL. Logo a taxa é um PISO — pode
   *  subir se a classificação for completada. Ver mqlSemClassificacao. */
  mqlRate: number;
  /** Leads com `mql` vazio/null no recorte. ~54% da base (2026-07, crônico:
   *  47-62%/mês desde jan). Exposto na UI pro leitor saber se a mqlRate é
   *  confiável (8% sem classificação) ou quase ficção (94% sem). */
  mqlSemClassificacao: number;
  agendadoPlus: number;
  pctAgendamento: number;
  anunciosAtivos: number;
  campanhasAtivas: number;
};

export type FunnelStep = { label: string; count: number; pctOfTotal: number };

export type AdsPerfRow = {
  rank: number;
  idAnuncio: string;
  agendados: number;
  /** MQL "sim" absolutos do anúncio (pro cruzamento custo/MQL com Meta Ads). */
  mqlSim: number;
  pctAgendamento: number;
  pctMql: number;
  pctInteracao: number;
  total: number;
  isUnknownId: boolean;
  /** Deltas vs. período anterior — igual aos KPIs. Ausentes no "Todo período".
   *  Os de % só existem quando o anúncio também teve leads no período anterior
   *  (senão não há taxa comparável). */
  totalDelta?: Delta;
  pctAgendamentoDelta?: Delta;
  pctMqlDelta?: Delta;
  pctInteracaoDelta?: Delta;
};

export type Deltas = {
  total: Delta;
  pctInteracao: Delta;
  mqlRate: Delta;
  agendadoPlus: Delta;
  anunciosAtivos: Delta;
  campanhasAtivas: Delta;
};

export type DashboardData = {
  workspaceId: string;
  range: DateRange;
  /** Período anterior derivado (M8). null = "Todo período" ou sem referência. */
  previousRange: DateRange | null;
  /** Filtros efetivamente aplicados (depois de drop dos inválidos). */
  filters: Filters;
  /** Dimensões disponíveis no recorte do período (ANTES dos filtros). */
  dimensions: Dimensions;
  kpis: Kpis;
  /** KPIs do período anterior (M8). null quando previousRange=null. */
  kpisPrevious: Kpis | null;
  /** Deltas atual vs anterior por KPI (M8). null quando previousRange=null. */
  deltas: Deltas | null;
  funnel: FunnelStep[];
  adsPerformance: AdsPerfRow[];
  /** Dados pros charts. monthlyEvolution (M8) é independente de filtros. */
  charts: ChartsData & { monthlyEvolution: MonthlyEvolutionPoint[] };
  leads: LeadRow[];
  fetchedAt: string;
  fetchMs: number;
  /** Quantos leads o período tem no total (ignora filtros) — útil pra UI. */
  totalNoPeriodo: number;
};

// Cache em memória do FETCH BASE (leads do período, sem filtros). Filters
// são aplicados sobre o resultado in-memory — zero round-trip DB extra.
type CacheEntry = { ts: number; leads: LeadRow[]; fetchMs: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

function cacheKey(workspaceId: string, range: DateRange): string {
  return `${workspaceId}|${range.from ?? ""}|${range.to ?? ""}`;
}

/** Invalida o cache base de um workspace (todas as janelas). Chamar após uma
 *  escrita (edição de status/mql) pra o próximo fetch refletir na hora. */
export function invalidateLeadsCache(workspaceId: string): void {
  const prefix = `${workspaceId}|`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

async function fetchBaseLeads(
  workspaceId: string,
  range: DateRange,
): Promise<{ leads: LeadRow[]; fetchMs: number; fromCache: boolean }> {
  const key = cacheKey(workspaceId, range);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < TTL_MS) {
    return { leads: hit.leads, fetchMs: hit.fetchMs, fromCache: true };
  }

  const supabase = getSupabaseAdmin();
  const t0 = Date.now();

  // PostgREST do Supabase tem hard cap em `db-max-rows` (1000 por default).
  // Solução: paginar do client em chunks de 1000 — Cleide (1818) → 2 round-trips.
  // Documentado no FRAMEWORK.md §4.
  const PAGE = 1000;
  const HARD_CAP = 10_000;
  let allLeads: LeadRow[] = [];
  let offset = 0;

  while (offset < HARD_CAP) {
    let q = supabase
      .from("terrace360_leads_atonhub")
      .select(
        "id, data, nome_lead, etapa_funil, resumo_conversa, telefone, ddd_lead, nome_campanha, id_anuncio, mql, canal_campanha, cidade_campanha, estado_campanha",
      )
      .eq("id_workspace_responsavel", workspaceId)
      .order("data", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (range.from) q = q.gte("data", `${range.from}T00:00:00Z`);
    if (range.to) q = q.lte("data", `${range.to}T23:59:59.999Z`);

    const { data, error } = await q;
    if (error) {
      console.error("[leads] supabase error", {
        workspaceId,
        offset,
        code: error.code,
        message: error.message,
      });
      throw new Error("Falha ao buscar leads do workspace");
    }
    const chunk = (data ?? []) as LeadRow[];
    allLeads = allLeads.concat(chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }

  const fetchMs = Date.now() - t0;
  cache.set(key, { ts: now, leads: allLeads, fetchMs });

  // GC oportunista — evita Map crescer indefinidamente.
  if (cache.size > 200) {
    for (const [k, v] of cache) {
      if (now - v.ts >= TTL_MS) cache.delete(k);
    }
  }

  return { leads: allLeads, fetchMs, fromCache: false };
}

/**
 * Filtra leads in-memory pelo range (inclusive ambos os limites).
 * Helper interno usado quando o fetch é expandido pra cobrir current+previous.
 *
 * Comparação por PORÇÃO DE DATA (YYYY-MM-DD), não por string ISO completa.
 *
 * Por quê: o PostgREST devolve `data` como ISO com offset explícito
 * ("2026-06-15T00:00:00+00:00"), enquanto uma borda construída como
 * "2026-06-15T00:00:00Z" usa sufixo Z. Comparar essas strings inteiras
 * quebra: no caractere do offset, '+' (43) < 'Z' (90), então
 * "...00:00+00:00" < "...00:00Z" é TRUE — e TODO lead de meia-noite UTC
 * era descartado da borda `from` do próprio dia. Resultado observado:
 * "Hoje" mostrava 0 leads mesmo com leads datados de hoje (o fetch no DB
 * pegava, o re-filtro em memória derrubava). Ranges multi-dia só perdiam
 * os leads do dia-borda (undercount silencioso).
 *
 * `data` é semanticamente uma data (sempre meia-noite UTC), então comparar
 * só os 10 primeiros chars contra range.from/to (YYYY-MM-DD) é robusto e
 * livre de ambiguidade de formato/timezone — mesma convenção que
 * buildDailyVolume/buildMonthlyEvolution já usam.
 */
function leadsInRange(leads: LeadRow[], range: DateRange): LeadRow[] {
  if (!range.from && !range.to) return leads;
  return leads.filter((l) => {
    if (!l.data) return false;
    const day = l.data.slice(0, 10); // "YYYY-MM-DD" em UTC
    if (range.from && day < range.from) return false;
    if (range.to && day > range.to) return false;
    return true;
  });
}

/**
 * Computa o union range cobrindo current ∪ previous pra fazer 1 fetch só.
 * Se previous é null → retorna current.
 */
function unionRange(current: DateRange, previous: DateRange | null): DateRange {
  if (!previous) return current;
  // "Todo período" + previous (não acontece pelo design, mas defensivo).
  if (!current.from || !current.to) return current;
  const from = previous.from && previous.from < current.from ? previous.from : current.from;
  const to = previous.to && previous.to > current.to ? previous.to : current.to;
  return { from, to };
}

/**
 * Agrega o dashboard do workspace.
 *
 * Computa em paralelo:
 * 1. Fetch base expandido cobrindo current ∪ previous (1 round-trip cacheado).
 *    Filters aplicados em memória pra cada janela.
 * 2. Fetch separado dos últimos 12 meses (ignora filtros — chart de
 *    trajetória do workspace inteiro). Cacheado independente.
 *
 * Resultado: kpis (current), kpisPrevious, deltas (current vs previous),
 * charts existentes (sobre current), monthlyEvolution (sobre 12 meses sem
 * filtro).
 */
export async function getDashboardData(
  workspaceId: string,
  range: DateRange,
  filtersIn: Filters = {},
  periodKey?: PeriodKey,
): Promise<DashboardData> {
  const prev = previousRange(range, periodKey);
  const expanded = unionRange(range, prev);

  // 12 meses corridos pro MonthlyEvolutionChart — independente do range
  // selecionado e dos filtros. Esse chart mostra a trajetória do workspace
  // inteiro, é a "vista panorâmica" do produto.
  const now = new Date();
  const twelveMoStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
  );
  const twelveMoRange: DateRange = {
    from: `${twelveMoStart.getUTCFullYear()}-${String(
      twelveMoStart.getUTCMonth() + 1,
    ).padStart(2, "0")}-01`,
    to: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
      2,
      "0",
    )}-${String(now.getUTCDate()).padStart(2, "0")}`,
  };

  // Os 2 fetches + a lista de exclusões são independentes — paralelizar.
  const [baseExpanded, twelveMo, excludedIds] = await Promise.all([
    fetchBaseLeads(workspaceId, expanded),
    fetchBaseLeads(workspaceId, twelveMoRange),
    getExcludedLeadIds(workspaceId),
  ]);

  // Leads marcados como teste somem de TUDO (KPIs, funil, ads, charts, tabela,
  // export, tools do TON). Filtro aplicado uma vez, antes de qualquer cálculo.
  const base = baseExpanded.leads.filter((l) => !excludedIds.has(l.id));
  const twelveMoLeads = twelveMo.leads.filter((l) => !excludedIds.has(l.id));
  const currentLeadsAll = leadsInRange(base, range);
  const previousLeadsAll = prev ? leadsInRange(base, prev) : [];

  // Dimensões e filtros derivam SEMPRE do recorte CURRENT (mais útil pra UI).
  const dimensions = computeDimensions(currentLeadsAll);
  const filters = dropInvalidFilters(filtersIn, dimensions, workspaceId);

  // Aplica filtros aos DOIS recortes — comparativo é "mesma lente filtrada
  // em janelas temporais diferentes" (decisão M8).
  const currentFiltered = applyFilters(currentLeadsAll, filters);
  const previousFiltered = prev ? applyFilters(previousLeadsAll, filters) : [];

  const kpis = computeKpis(currentFiltered);
  const kpisPrevious = prev ? computeKpis(previousFiltered) : null;
  const deltas: Deltas | null = kpisPrevious
    ? {
        total: computeDelta(kpis.total, kpisPrevious.total, {
          kind: "count",
          orientation: "higher_is_better",
        }),
        pctInteracao: computeDelta(kpis.pctInteracao, kpisPrevious.pctInteracao, {
          kind: "percent",
          orientation: "higher_is_better",
        }),
        mqlRate: computeDelta(kpis.mqlRate, kpisPrevious.mqlRate, {
          kind: "percent",
          orientation: "higher_is_better",
        }),
        agendadoPlus: computeDelta(kpis.agendadoPlus, kpisPrevious.agendadoPlus, {
          kind: "count",
          orientation: "higher_is_better",
        }),
        anunciosAtivos: computeDelta(
          kpis.anunciosAtivos,
          kpisPrevious.anunciosAtivos,
          { kind: "count", orientation: "neutral" },
        ),
        campanhasAtivas: computeDelta(
          kpis.campanhasAtivas,
          kpisPrevious.campanhasAtivas,
          { kind: "count", orientation: "neutral" },
        ),
      }
    : null;

  // Performance por anúncio + comparativo por anúncio (Total vs período anterior).
  const adsCurrent = computeAdsPerformance(currentFiltered);
  const adsPerformance = prev
    ? attachAdsPerfDeltas(adsCurrent, computeAdsPerformance(previousFiltered))
    : adsCurrent;

  return {
    workspaceId,
    range,
    previousRange: prev,
    filters,
    dimensions,
    kpis,
    kpisPrevious,
    deltas,
    funnel: computeFunnel(currentFiltered),
    adsPerformance,
    charts: {
      ...buildAllCharts(currentFiltered),
      // MonthlyEvolution: dos 12 meses, SEM filtros aplicados (trajetória
      // do workspace inteiro — decisão M8 pendência B). Já sem os leads de teste.
      monthlyEvolution: buildMonthlyEvolution(twelveMoLeads),
    },
    leads: currentFiltered,
    fetchedAt: new Date().toISOString(),
    fetchMs: baseExpanded.fetchMs + twelveMo.fetchMs,
    totalNoPeriodo: currentLeadsAll.length,
  };
}

export function computeKpis(leads: LeadRow[]): Kpis {
  const total = leads.length;
  let novos = 0;
  let mqlSim = 0;
  let mqlSemClassificacao = 0;
  let agendadoPlus = 0;
  const anuncios = new Set<string>();
  const campanhas = new Set<string>();

  for (const l of leads) {
    const g = classify(l.etapa_funil);
    if (g === "Novo") novos++;
    if (g === "Agendado+") agendadoPlus++;
    const mqlRaw = (l.mql ?? "").trim();
    if (mqlRaw === "") mqlSemClassificacao++;
    if (mqlRaw.toLowerCase() === "sim") mqlSim++;
    if (l.id_anuncio && l.id_anuncio.trim()) anuncios.add(l.id_anuncio.trim());
    if (l.nome_campanha && l.nome_campanha.trim()) campanhas.add(l.nome_campanha.trim());
  }

  const interagiram = total - novos;
  const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

  return {
    total,
    interagiram,
    pctInteracao: safeDiv(interagiram, total),
    mqlSim,
    mqlRate: safeDiv(mqlSim, total),
    mqlSemClassificacao,
    agendadoPlus,
    pctAgendamento: safeDiv(agendadoPlus, total),
    anunciosAtivos: anuncios.size,
    campanhasAtivas: campanhas.size,
  };
}

export function computeFunnel(leads: LeadRow[]): FunnelStep[] {
  const total = leads.length;
  let novos = 0;
  let mqlSim = 0;
  let agendadoPlus = 0;
  for (const l of leads) {
    const g = classify(l.etapa_funil);
    if (g === "Novo") novos++;
    if (g === "Agendado+") agendadoPlus++;
    if ((l.mql ?? "").toLowerCase().trim() === "sim") mqlSim++;
  }
  const interagiram = total - novos;
  const pct = (n: number) => (total > 0 ? n / total : 0);

  return [
    { label: "Leads Totais", count: total, pctOfTotal: 1 },
    { label: "Interagiram", count: interagiram, pctOfTotal: pct(interagiram) },
    { label: "MQL Sim", count: mqlSim, pctOfTotal: pct(mqlSim) },
    { label: GRUPO_LABEL["Agendado+"], count: agendadoPlus, pctOfTotal: pct(agendadoPlus) },
  ];
}

export function computeAdsPerformance(leads: LeadRow[]): AdsPerfRow[] {
  type Bucket = {
    idAnuncio: string;
    isUnknownId: boolean;
    total: number;
    agendados: number;
    mqlSim: number;
    novos: number;
  };
  const map = new Map<string, Bucket>();

  for (const l of leads) {
    const raw = (l.id_anuncio ?? "").trim();
    const isUnknownId = !raw;
    const key = isUnknownId ? "__sem_id__" : raw;
    let b = map.get(key);
    if (!b) {
      b = { idAnuncio: isUnknownId ? "Sem ID" : raw, isUnknownId, total: 0, agendados: 0, mqlSim: 0, novos: 0 };
      map.set(key, b);
    }
    b.total++;
    const g = classify(l.etapa_funil);
    if (g === "Novo") b.novos++;
    if (g === "Agendado+") b.agendados++;
    if ((l.mql ?? "").toLowerCase().trim() === "sim") b.mqlSim++;
  }

  const rows: AdsPerfRow[] = [];
  for (const b of map.values()) {
    const interagiram = b.total - b.novos;
    const safeDiv = (a: number, c: number) => (c > 0 ? a / c : 0);
    rows.push({
      rank: 0,
      idAnuncio: b.idAnuncio,
      agendados: b.agendados,
      mqlSim: b.mqlSim,
      pctAgendamento: safeDiv(b.agendados, b.total),
      pctMql: safeDiv(b.mqlSim, b.total),
      pctInteracao: safeDiv(interagiram, b.total),
      total: b.total,
      isUnknownId: b.isUnknownId,
    });
  }

  rows.sort((a, b) => {
    if (a.isUnknownId && !b.isUnknownId) return -1;
    if (!a.isUnknownId && b.isUnknownId) return 1;
    return b.total - a.total;
  });

  let nextRank = 1;
  for (const r of rows) {
    if (!r.isUnknownId) r.rank = nextRank++;
  }

  return rows;
}

/**
 * Anexa a cada anúncio do período ATUAL os deltas vs. o período anterior,
 * casando por idAnuncio (mesma régua dos KPIs):
 * - Total: sempre (count, higher_is_better). Sem par no anterior → "novo".
 * - % Agendamento / MQL / Interação: só quando o anúncio TAMBÉM teve leads no
 *   anterior (senão não há taxa comparável) — percent (pp), higher_is_better.
 */
function attachAdsPerfDeltas(current: AdsPerfRow[], previous: AdsPerfRow[]): AdsPerfRow[] {
  const prevByAd = new Map<string, AdsPerfRow>();
  for (const p of previous) prevByAd.set(p.idAnuncio, p);
  const pctOpts = { kind: "percent" as const, orientation: "higher_is_better" as const };
  return current.map((r) => {
    const prev = prevByAd.get(r.idAnuncio);
    return {
      ...r,
      totalDelta: computeDelta(r.total, prev?.total ?? 0, {
        kind: "count",
        orientation: "higher_is_better",
      }),
      pctAgendamentoDelta: prev ? computeDelta(r.pctAgendamento, prev.pctAgendamento, pctOpts) : undefined,
      pctMqlDelta: prev ? computeDelta(r.pctMql, prev.pctMql, pctOpts) : undefined,
      pctInteracaoDelta: prev ? computeDelta(r.pctInteracao, prev.pctInteracao, pctOpts) : undefined,
    };
  });
}
