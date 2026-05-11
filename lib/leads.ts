import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import { classify, type Grupo } from "./classify";
import type { DateRange } from "./period";

// Linha crua da terrace360_leads_atonhub — apenas as colunas que o dashboard
// consome. Demais colunas (probabilidade_avanco, dia_hora_semana, cliente,
// titulo_campanha) são ignoradas no M3 — entram em M4/M5 conforme necessário.
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
  interagiram: number;        // total - Novo
  pctInteracao: number;       // 0..1
  mqlSim: number;
  mqlRate: number;            // 0..1
  agendadoPlus: number;
  pctAgendamento: number;     // 0..1 (do total)
  anunciosAtivos: number;     // distinct id_anuncio not null
  campanhasAtivas: number;    // distinct nome_campanha not null
};

export type FunnelStep = { label: string; count: number; pctOfTotal: number };

export type AdsPerfRow = {
  rank: number;
  idAnuncio: string;          // "Sem ID" quando null/vazio
  agendados: number;
  pctAgendamento: number;     // 0..1
  pctMql: number;             // 0..1
  pctInteracao: number;       // 0..1
  total: number;
  isUnknownId: boolean;
};

export type DashboardData = {
  workspaceId: string;
  range: DateRange;
  kpis: Kpis;
  funnel: FunnelStep[];
  adsPerformance: AdsPerfRow[];
  leads: LeadRow[];           // ordenado por data desc
  fetchedAt: string;          // ISO timestamp da query (pra debug header)
  fetchMs: number;            // tempo do round-trip Supabase
};

// Cache em memória — TTL 60s por chave (workspace + período).
// Renovado por overwrite (sem janela; última escrita ganha).
type CacheEntry = { ts: number; data: DashboardData };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

function cacheKey(workspaceId: string, range: DateRange): string {
  return `${workspaceId}|${range.from ?? ""}|${range.to ?? ""}`;
}

/**
 * Lê leads do workspace + período, agrega tudo que o dashboard precisa.
 * Cache 60s memo in-memory.
 *
 * Filtragem do período no SERVIDOR via .gte/.lte no campo `data`.
 * 1816 linhas (workspace mais pesado) chegam em ~200KB de JSON — toleráveis.
 */
export async function getDashboardData(
  workspaceId: string,
  range: DateRange,
): Promise<DashboardData> {
  const key = cacheKey(workspaceId, range);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < TTL_MS) {
    return hit.data;
  }

  const supabase = getSupabaseAdmin();
  const t0 = Date.now();

  // PostgREST do Supabase (REST API) tem hard cap em `db-max-rows` (1000
  // por default em projetos Aton). `.range(0, 4999)` é IGNORADO acima
  // desse cap. Solução robusta: paginar do client em chunks de 1000.
  //
  // Cleide tem ~1816 leads → 2 round-trips. Aceita a latência: cada chunk
  // é ~50-150ms, total fica abaixo de 500ms typical. Cache 60s amortiza.
  const PAGE = 1000;
  const HARD_CAP = 10_000; // sanity bound — pára se workspace ficar absurdo
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
    if (chunk.length < PAGE) break; // última página
    offset += PAGE;
  }

  const fetchMs = Date.now() - t0;
  const leads = allLeads;

  const dashboard: DashboardData = {
    workspaceId,
    range,
    kpis: computeKpis(leads),
    funnel: computeFunnel(leads),
    adsPerformance: computeAdsPerformance(leads),
    leads,
    fetchedAt: new Date().toISOString(),
    fetchMs,
  };

  cache.set(key, { ts: now, data: dashboard });

  // Garbage collection oportunista — evita o Map crescer indefinidamente
  // (cada chave é workspace+período, há combinações possíveis mas finitas).
  if (cache.size > 200) {
    for (const [k, v] of cache) {
      if (now - v.ts >= TTL_MS) cache.delete(k);
    }
  }

  return dashboard;
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
      rank: 0, // preenchido depois
      idAnuncio: b.idAnuncio,
      agendados: b.agendados,
      pctAgendamento: safeDiv(b.agendados, b.total),
      pctMql: safeDiv(b.mqlSim, b.total),
      pctInteracao: safeDiv(interagiram, b.total),
      total: b.total,
      isUnknownId: b.isUnknownId,
    });
  }

  // Ordenação: Sem ID no topo, depois por total desc.
  rows.sort((a, b) => {
    if (a.isUnknownId && !b.isUnknownId) return -1;
    if (!a.isUnknownId && b.isUnknownId) return 1;
    return b.total - a.total;
  });

  // Rank: começa em 1 nas linhas "com ID" (Sem ID fica como —).
  let nextRank = 1;
  for (const r of rows) {
    if (!r.isUnknownId) {
      r.rank = nextRank++;
    }
  }

  return rows;
}
