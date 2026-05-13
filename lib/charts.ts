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
  /** Leads no grupo Agendado+ (agendado/especialista/negociacao/financeiro). */
  agendado_plus: number;
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

  // Bucket: dia UTC → {total, mqlSim, agendadoPlus}.
  const map = new Map<string, { total: number; mql_sim: number; agendado_plus: number }>();
  let minDay = Number.POSITIVE_INFINITY;
  let maxDay = Number.NEGATIVE_INFINITY;

  for (const l of leads) {
    if (!l.data) continue;
    const day = l.data.slice(0, 10); // ISO "YYYY-MM-DDT..." → "YYYY-MM-DD"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;

    const isMqlSim = (l.mql ?? "").toLowerCase().trim() === "sim";
    const isAgendadoPlus = classify(l.etapa_funil) === "Agendado+";

    const bucket = map.get(day);
    if (bucket) {
      bucket.total++;
      if (isMqlSim) bucket.mql_sim++;
      if (isAgendadoPlus) bucket.agendado_plus++;
    } else {
      map.set(day, {
        total: 1,
        mql_sim: isMqlSim ? 1 : 0,
        agendado_plus: isAgendadoPlus ? 1 : 0,
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
      agendado_plus: bucket?.agendado_plus ?? 0,
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
  name: "Sim" | "Não";
  value: number;
  color: string;
};

/**
 * Donut MQL — só conta leads que TÊM valor de MQL marcado (sim ou não).
 * Leads sem MQL marcado (NULL no banco) são excluídos do total — a métrica
 * é "qualificação sobre o universo dos leads avaliados", não sobre o total
 * de leads do recorte.
 */
export function buildMqlDonut(leads: LeadRow[]): MqlDonutSlice[] {
  let sim = 0;
  let nao = 0;

  for (const l of leads) {
    const v = (l.mql ?? "").toLowerCase().trim();
    if (v === "sim") sim++;
    else if (v === "não" || v === "nao") nao++;
    // Sem MQL marcado → ignora.
  }

  return [
    { name: "Sim", value: sim, color: "#10b981" }, // success
    { name: "Não", value: nao, color: "#dc2626" }, // destructive
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
// Evolução Mensal (M8) — rolling 12 meses

export type MonthlyEvolutionPoint = {
  /** "YYYY-MM" UTC. */
  month: string;
  /** Label legível em pt-BR pra eixo X (ex: "jan/26"). */
  label: string;
  total: number;
  mqlSim: number;
  agendado: number;
  /** % Interação no mês, 0..100 (não 0..1 — facilita formato YAxis). */
  interacao: number;
};

const PT_MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/**
 * Bucketiza leads por mês UTC e calcula 4 séries pro chart Evolução Mensal.
 *
 * Input: leads do workspace nos últimos 12 meses (computado server-side
 * em lib/leads.ts, INDEPENDENTE dos filtros — esse chart mostra a
 * trajetória total do workspace).
 *
 * Preenchimento: meses vazios entre o primeiro mês com lead e o mês atual
 * recebem total=0, mqlSim=0, agendado=0, interacao=0. Sem isso, o line
 * chart "pula" meses e a leitura fica quebrada.
 *
 * Limite: máximo 12 meses (rolling window). Se workspace tem mais
 * histórico, mostra só os últimos 12.
 */
export function buildMonthlyEvolution(leads: LeadRow[]): MonthlyEvolutionPoint[] {
  if (leads.length === 0) return [];

  type Bucket = { total: number; mqlSim: number; agendado: number; novo: number };
  const map = new Map<string, Bucket>();

  // Janela: últimos 12 meses contando o mês corrente.
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  let minMonth: string | null = null;
  let maxMonth: string | null = null;

  for (const l of leads) {
    if (!l.data) continue;
    const month = l.data.slice(0, 7); // "YYYY-MM"
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    // Drop tudo anterior ao cutoff (rolling 12 meses).
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
    if (d < cutoff) continue;

    const isMqlSim = (l.mql ?? "").toLowerCase().trim() === "sim";
    const grupo = classify(l.etapa_funil);
    const isAgendado = grupo === "Agendado+";
    const isNovo = grupo === "Novo";

    const bucket = map.get(month);
    if (bucket) {
      bucket.total++;
      if (isMqlSim) bucket.mqlSim++;
      if (isAgendado) bucket.agendado++;
      if (isNovo) bucket.novo++;
    } else {
      map.set(month, {
        total: 1,
        mqlSim: isMqlSim ? 1 : 0,
        agendado: isAgendado ? 1 : 0,
        novo: isNovo ? 1 : 0,
      });
    }

    if (!minMonth || month < minMonth) minMonth = month;
    if (!maxMonth || month > maxMonth) maxMonth = month;
  }

  if (!minMonth || !maxMonth) return [];

  // Preenche meses entre min e max (gera continuidade visual).
  const points: MonthlyEvolutionPoint[] = [];
  let [y, m] = minMonth.split("-").map(Number);
  const [maxY, maxM] = maxMonth.split("-").map(Number);

  while (y < maxY || (y === maxY && m <= maxM)) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const b = map.get(month) ?? { total: 0, mqlSim: 0, agendado: 0, novo: 0 };
    const interagiram = b.total - b.novo;
    const interacao = b.total > 0 ? (interagiram / b.total) * 100 : 0;
    const yy = String(y).slice(-2);
    points.push({
      month,
      label: `${PT_MONTHS[m - 1]}/${yy}`,
      total: b.total,
      mqlSim: b.mqlSim,
      agendado: b.agendado,
      interacao: Number(interacao.toFixed(1)),
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  // Garantia adicional do limite 12 (defensivo se cutoff falhou).
  if (points.length > 12) {
    return points.slice(points.length - 12);
  }
  return points;
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
