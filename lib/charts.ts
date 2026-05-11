import { classify, GRUPO_COLOR, type Grupo } from "./classify";
import type { LeadRow } from "./leads";

// Funções puras que recebem leads (já filtrados pelo agregador) e retornam
// estruturas serializáveis prontas pra Recharts no client.
//
// Decisão arquitetural: agregação roda no servidor (em getDashboardData),
// o client recebe só o array agregado — pequeno e rápido. A vantagem é
// duplicada quando há cache hit do fetch base (M3): mudar filtro recomputa
// charts a partir do mesmo cache, sem novo round-trip ao DB.

// ──────────────────────────────────────────────────────────────────────────
// Volume diário

export type DailyVolumePoint = {
  /** YYYY-MM-DD em UTC. */
  date: string;
  /** Total de leads do dia. */
  total: number;
  /** Leads com mql=sim do dia. */
  mql_sim: number;
};

/**
 * Agrupa leads por dia (UTC) e preenche buckets vazios entre min e max do
 * recorte. Sem o preenchimento, o LineChart "pula" dias e a curva fica
 * visualmente quebrada — referência: dashboard.html do CRM Master também
 * preenche.
 *
 * Retorna [] se a entrada é vazia.
 */
export function buildDailyVolume(leads: LeadRow[]): DailyVolumePoint[] {
  if (leads.length === 0) return [];

  // Bucket: dia UTC → {total, mqlSim}.
  const map = new Map<string, { total: number; mql_sim: number }>();
  let minDay = Number.POSITIVE_INFINITY;
  let maxDay = Number.NEGATIVE_INFINITY;

  for (const l of leads) {
    if (!l.data) continue;
    const day = l.data.slice(0, 10); // ISO "YYYY-MM-DDT..." → "YYYY-MM-DD"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;

    const bucket = map.get(day);
    if (bucket) {
      bucket.total++;
      if ((l.mql ?? "").toLowerCase().trim() === "sim") bucket.mql_sim++;
    } else {
      map.set(day, {
        total: 1,
        mql_sim: (l.mql ?? "").toLowerCase().trim() === "sim" ? 1 : 0,
      });
    }

    const t = Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)),
    );
    if (t < minDay) minDay = t;
    if (t > maxDay) maxDay = t;
  }

  if (map.size === 0) return [];

  // Preencher buckets vazios entre min e max.
  const points: DailyVolumePoint[] = [];
  const oneDay = 24 * 60 * 60 * 1000;
  for (let t = minDay; t <= maxDay; t += oneDay) {
    const d = new Date(t);
    const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const bucket = map.get(day);
    points.push({
      date: day,
      total: bucket?.total ?? 0,
      mql_sim: bucket?.mql_sim ?? 0,
    });
  }

  return points;
}

// ──────────────────────────────────────────────────────────────────────────
// Volume por Campanha (top 10)

export type CampaignVolumePoint = {
  /** Label truncado pra exibir (até 25 chars + "…"). */
  name: string;
  /** Label completo pra tooltip. */
  fullName: string;
  total: number;
};

export function buildCampaignVolume(leads: LeadRow[]): CampaignVolumePoint[] {
  if (leads.length === 0) return [];

  const counts = new Map<string, number>();
  for (const l of leads) {
    const raw = (l.nome_campanha ?? "").trim();
    const name = raw === "" ? "Sem campanha" : raw;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([fullName, total]) => ({
      name: fullName.length > 25 ? fullName.slice(0, 25) + "…" : fullName,
      fullName,
      total,
    }));
}

// ──────────────────────────────────────────────────────────────────────────
// MQL Donut

export type MqlDonutSlice = {
  name: "Sim" | "Não" | "Sem MQL";
  value: number;
  color: string;
};

export function buildMqlDonut(leads: LeadRow[]): MqlDonutSlice[] {
  let sim = 0;
  let nao = 0;
  let semMql = 0;

  for (const l of leads) {
    const v = (l.mql ?? "").toLowerCase().trim();
    if (v === "sim") sim++;
    else if (v === "não" || v === "nao") nao++;
    else semMql++;
  }

  // Mantemos as 3 fatias mesmo zeradas — o donut fica mais previsível
  // visualmente (sempre mesmas 3 cores na legenda). Tooltip filtra zero.
  return [
    { name: "Sim", value: sim, color: "#69F0AE" },
    { name: "Não", value: nao, color: "#FF5252" },
    { name: "Sem MQL", value: semMql, color: "rgba(232, 237, 242, 0.15)" },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Distribuição por Etapa

export type StageDistributionPoint = {
  name: Grupo;
  value: number;
  color: string;
};

const GRUPO_ORDER: Grupo[] = ["Novo", "Em conversa", "Agendado+", "Descartado", "Outros"];

/**
 * Agrupa por grupo da taxonomia (lib/classify.ts). Mantém todos os 5 grupos
 * na ordem canônica — grupos com 0 ainda aparecem como barra mínima (1px
 * visual via Recharts). Tooltip mostra count real.
 *
 * Por que não omitir zeros? UX consistente: o assinante vê sempre a mesma
 * estrutura de 5 categorias, independente de período/filtro, evitando
 * "sumiço" de categoria visualmente confuso.
 */
export function buildStageDistribution(leads: LeadRow[]): StageDistributionPoint[] {
  const counts: Record<Grupo, number> = {
    Novo: 0,
    "Em conversa": 0,
    "Agendado+": 0,
    Descartado: 0,
    Outros: 0,
  };
  for (const l of leads) {
    counts[classify(l.etapa_funil)]++;
  }
  return GRUPO_ORDER.map((g) => ({
    name: g,
    value: counts[g],
    color: GRUPO_COLOR[g],
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Estrutura agregada

export type ChartsData = {
  dailyVolume: DailyVolumePoint[];
  campaignVolume: CampaignVolumePoint[];
  mqlDonut: MqlDonutSlice[];
  stageDistribution: StageDistributionPoint[];
};

export function buildAllCharts(leads: LeadRow[]): ChartsData {
  return {
    dailyVolume: buildDailyVolume(leads),
    campaignVolume: buildCampaignVolume(leads),
    mqlDonut: buildMqlDonut(leads),
    stageDistribution: buildStageDistribution(leads),
  };
}
