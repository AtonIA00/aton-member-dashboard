import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import { classify } from "./classify";
import type { DateRange } from "./period";
import {
  applyFilters,
  computeDimensions,
  dropInvalidFilters,
  type Dimensions,
  type Filters,
} from "./filters";
import { buildAllCharts, type ChartsData } from "./charts";

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
  mqlRate: number;
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
  pctAgendamento: number;
  pctMql: number;
  pctInteracao: number;
  total: number;
  isUnknownId: boolean;
};

export type DashboardData = {
  workspaceId: string;
  range: DateRange;
  /** Filtros efetivamente aplicados (depois de drop dos inválidos). */
  filters: Filters;
  /** Dimensões disponíveis no recorte do período (ANTES dos filtros). */
  dimensions: Dimensions;
  kpis: Kpis;
  funnel: FunnelStep[];
  adsPerformance: AdsPerfRow[];
  /** Dados pros 4 charts (M5) — derivados dos mesmos leads filtrados. */
  charts: ChartsData;
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
 * Agrega o dashboard do workspace pro recorte (período + filtros opcionais).
 *
 * Ordem da computação:
 * 1. Fetch base (cacheado por workspace+período).
 * 2. computeDimensions(base) — dropdowns refletem o que existe no período,
 *    NÃO o que sobra depois dos filtros.
 * 3. dropInvalidFilters(filters, dimensions) — silenciosamente remove
 *    filtros cujo valor não existe.
 * 4. applyFilters(base, filters) — leads do recorte filtrado.
 * 5. KPIs / Funil / Ads / Tabela computados sobre o subset filtrado.
 */
export async function getDashboardData(
  workspaceId: string,
  range: DateRange,
  filtersIn: Filters = {},
): Promise<DashboardData> {
  const { leads: base, fetchMs } = await fetchBaseLeads(workspaceId, range);
  const dimensions = computeDimensions(base);
  const filters = dropInvalidFilters(filtersIn, dimensions, workspaceId);
  const filtered = applyFilters(base, filters);

  return {
    workspaceId,
    range,
    filters,
    dimensions,
    kpis: computeKpis(filtered),
    funnel: computeFunnel(filtered),
    adsPerformance: computeAdsPerformance(filtered),
    charts: buildAllCharts(filtered),
    leads: filtered,
    fetchedAt: new Date().toISOString(),
    fetchMs,
    totalNoPeriodo: base.length,
  };
}

export function computeKpis(leads: LeadRow[]): Kpis {
  const total = leads.length;
  let novos = 0;
  let mqlSim = 0;
  let agendadoPlus = 0;
  const anuncios = new Set<string>();
  const campanhas = new Set<string>();

  for (const l of leads) {
    const g = classify(l.etapa_funil);
    if (g === "Novo") novos++;
    if (g === "Agendado+") agendadoPlus++;
    if ((l.mql ?? "").toLowerCase().trim() === "sim") mqlSim++;
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
    { label: "Agendado+", count: agendadoPlus, pctOfTotal: pct(agendadoPlus) },
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
