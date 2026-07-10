import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import { previousRange, type DateRange, type PeriodKey } from "./period";
import { computeDelta, type Delta } from "./deltas";

// Camada de dados do painel dedicado da Trisul Parcerias (outbound/reativação).
// Espelha lib/leads.ts, mas a fonte é dedicada (não terrace360, sem
// id_workspace_responsavel — a tabela inteira é da Trisul).
//
// Fonte única da matemática: as views trisul_kpis_diario (cubo de contagens
// por dia BRT × campanha × coordenador) e trisul_atendimentos (cru, pra tabela
// detalhada). As TAXAS são computadas em TS a partir das somas do recorte —
// necessário pra respeitar o período/filtros (a view resumo é só all-time).
// SOMENTE LEITURA.

// ── Config / gate ──────────────────────────────────────────────────────────
// workspace_id da Trisul (identidade HMAC/acesso). Env pra ajustar sem deploy.
export function trisulWorkspaceId(): string {
  return process.env.MEMBER_DASHBOARD_TRISUL_WORKSPACE_ID?.trim() || "314289";
}
export function isTrisulEnabled(): boolean {
  return process.env.MEMBER_DASHBOARD_TRISUL_ENABLED === "true";
}
/** Este workspace deve renderizar a tela dedicada da Trisul? (flag + id) */
export function isTrisulWorkspace(workspaceId: string): boolean {
  return isTrisulEnabled() && workspaceId === trisulWorkspaceId();
}

// ── Tipos ───────────────────────────────────────────────────────────────────
export type TrisulDiarioRow = {
  dia: string; // YYYY-MM-DD (BRT — a view já converte)
  campanha: string | null;
  coordinator_id: number | null;
  coordenador_nome: string | null;
  disparos: number;
  respostas: number;
  falhas_envio: number;
  encerramentos: number;
  ativos_confirmados: number;
  atuam_parcerias: number;
  contato_coordenador: number;
  nao_atua_mercado: number;
  nao_atua_parcerias: number;
  sem_interacao: number;
  em_andamento: number;
  resp_no_disparo: number;
  resp_fup1: number;
  resp_fup2: number;
  resp_fup3: number;
  canal_ligacao: number;
  canal_whatsapp: number;
  canal_pessoalmente: number;
  canal_outro: number;
};

export type TrisulAtendimento = {
  id: string;
  partner_id: number | null;
  nome: string | null;
  telefone: string | null;
  coordenador_nome: string | null;
  campanha: string | null;
  disparo_at: string | null;
  status_envio: string | null;
  respondeu: boolean | null;
  tentativas_fup: number | null;
  resultado: string | null;
  convertido: boolean | null;
  canal_contato_coordenador: string | null;
  resumo_conversa: string | null;
};

// Contagens somadas no recorte (grão bruto — taxas derivam daqui).
export type TrisulCounts = {
  disparos: number;
  respostas: number;
  falhasEnvio: number;
  encerramentos: number;
  ativosConfirmados: number;
  atuamParcerias: number;
  contatoCoordenador: number;
  naoAtuaMercado: number;
  naoAtuaParcerias: number;
  semInteracao: number;
  emAndamento: number;
  respNoDisparo: number;
  respFup1: number;
  respFup2: number;
  respFup3: number;
  canalLigacao: number;
  canalWhatsapp: number;
  canalPessoalmente: number;
  canalOutro: number;
};

export type TrisulKpis = TrisulCounts & {
  // Taxas 0..1 (UI formata *100), mesmas fórmulas da spec §4.
  taxaResposta: number; // respostas/disparos
  taxaFalha: number; // falhas/disparos
  taxaAtivos: number; // ativos/respostas
  conversao: number; // ativos/disparos
  pctAtuam: number; // atuam_parcerias/respostas
  pctContatoCoord: number; // contato_coordenador/respostas
};

export type TrisulDeltas = {
  disparos: Delta;
  taxaResposta: Delta;
  taxaAtivos: Delta;
  conversao: Delta;
  pctAtuam: Delta;
  pctContatoCoord: Delta;
};

export type TrisulDimensions = {
  campanhas: string[];
  coordenadores: string[];
};

export type TrisulFilters = {
  campanha?: string;
  coordenador?: string;
};

export type StatusSlice = { name: string; value: number; color: string };
export type FollowupPoint = { name: string; value: number };
export type CanalSlice = { name: string; value: number; color: string };
export type CoordRankRow = {
  coordenador: string;
  disparos: number;
  respostas: number;
  ativos: number;
  taxaResposta: number;
  conversao: number;
};
export type DailyPoint = { dia: string; disparos: number; respostas: number };

export type TrisulDashboardData = {
  range: DateRange;
  previousRange: DateRange | null;
  filters: TrisulFilters;
  dimensions: TrisulDimensions;
  kpis: TrisulKpis;
  kpisPrevious: TrisulKpis | null;
  deltas: TrisulDeltas | null;
  charts: {
    daily: DailyPoint[];
    status: StatusSlice[];
    followup: FollowupPoint[];
    canal: CanalSlice[];
    coordRanking: CoordRankRow[];
  };
  atendimentos: TrisulAtendimento[];
  totalNoPeriodo: number; // nº de disparos no período (ignora filtros)
  fetchedAt: string;
};

// ── Cores (paleta Aton) ──────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  Confirmados: "#10b981",
  "Não atua no mercado": "#6b7280",
  "Não atua com parcerias": "#f59e0b",
  "Sem interação": "#94a3b8",
  "Em andamento": "#0057ff",
};
const CANAL_COLORS: Record<string, string> = {
  Ligação: "#0057ff",
  WhatsApp: "#10b981",
  Pessoalmente: "#00c2ff",
  Outro: "#6b7280",
};

// ── Fetch (cache curto em memória; a view é pequena) ─────────────────────────
type DiarioCache = { ts: number; rows: TrisulDiarioRow[] };
let diarioCache: DiarioCache | null = null;
const TTL_MS = 60_000;

function n(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
}

async function fetchDiario(): Promise<TrisulDiarioRow[]> {
  const now = Date.now();
  if (diarioCache && now - diarioCache.ts < TTL_MS) return diarioCache.rows;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("trisul_kpis_diario")
    .select("*")
    .order("dia", { ascending: true });
  if (error) {
    console.error("[trisul] fetchDiario", { message: error.message });
    throw new Error("Falha ao buscar KPIs da Trisul");
  }
  const rows = (data ?? []).map((r) => ({
    dia: String(r.dia).slice(0, 10),
    campanha: r.campanha ?? null,
    coordinator_id: r.coordinator_id ?? null,
    coordenador_nome: r.coordenador_nome ?? null,
    disparos: n(r.disparos),
    respostas: n(r.respostas),
    falhas_envio: n(r.falhas_envio),
    encerramentos: n(r.encerramentos),
    ativos_confirmados: n(r.ativos_confirmados),
    atuam_parcerias: n(r.atuam_parcerias),
    contato_coordenador: n(r.contato_coordenador),
    nao_atua_mercado: n(r.nao_atua_mercado),
    nao_atua_parcerias: n(r.nao_atua_parcerias),
    sem_interacao: n(r.sem_interacao),
    em_andamento: n(r.em_andamento),
    resp_no_disparo: n(r.resp_no_disparo),
    resp_fup1: n(r.resp_fup1),
    resp_fup2: n(r.resp_fup2),
    resp_fup3: n(r.resp_fup3),
    canal_ligacao: n(r.canal_ligacao),
    canal_whatsapp: n(r.canal_whatsapp),
    canal_pessoalmente: n(r.canal_pessoalmente),
    canal_outro: n(r.canal_outro),
  })) as TrisulDiarioRow[];
  diarioCache = { ts: now, rows };
  return rows;
}

const PAGE = 1000;

async function fetchAtendimentos(
  range: DateRange,
  filters: TrisulFilters,
): Promise<TrisulAtendimento[]> {
  const supabase = getSupabaseAdmin();
  let all: TrisulAtendimento[] = [];
  let offset = 0;
  // Paginação PostgREST (FRAMEWORK §4) — a tabela pode crescer.
  for (;;) {
    let q = supabase
      .from("trisul_atendimentos")
      .select(
        "id, partner_id, nome, telefone, coordenador_nome, campanha, disparo_at, status_envio, respondeu, tentativas_fup, resultado, convertido, canal_contato_coordenador, resumo_conversa",
      )
      .order("disparo_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (range.from) q = q.gte("disparo_at", `${range.from}T00:00:00Z`);
    if (range.to) q = q.lte("disparo_at", `${range.to}T23:59:59.999Z`);
    if (filters.campanha) q = q.eq("campanha", filters.campanha);
    if (filters.coordenador) q = q.eq("coordenador_nome", filters.coordenador);

    const { data, error } = await q;
    if (error) {
      console.error("[trisul] fetchAtendimentos", { message: error.message });
      throw new Error("Falha ao buscar atendimentos da Trisul");
    }
    const chunk = (data ?? []) as TrisulAtendimento[];
    all = all.concat(chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── Agregação ────────────────────────────────────────────────────────────────
function inRange(dia: string, range: DateRange): boolean {
  if (range.from && dia < range.from) return false;
  if (range.to && dia > range.to) return false;
  return true;
}

function applyDiarioFilters(rows: TrisulDiarioRow[], f: TrisulFilters): TrisulDiarioRow[] {
  return rows.filter(
    (r) =>
      (!f.campanha || r.campanha === f.campanha) &&
      (!f.coordenador || r.coordenador_nome === f.coordenador),
  );
}

function sumCounts(rows: TrisulDiarioRow[]): TrisulCounts {
  const acc: TrisulCounts = {
    disparos: 0, respostas: 0, falhasEnvio: 0, encerramentos: 0,
    ativosConfirmados: 0, atuamParcerias: 0, contatoCoordenador: 0,
    naoAtuaMercado: 0, naoAtuaParcerias: 0, semInteracao: 0, emAndamento: 0,
    respNoDisparo: 0, respFup1: 0, respFup2: 0, respFup3: 0,
    canalLigacao: 0, canalWhatsapp: 0, canalPessoalmente: 0, canalOutro: 0,
  };
  for (const r of rows) {
    acc.disparos += r.disparos;
    acc.respostas += r.respostas;
    acc.falhasEnvio += r.falhas_envio;
    acc.encerramentos += r.encerramentos;
    acc.ativosConfirmados += r.ativos_confirmados;
    acc.atuamParcerias += r.atuam_parcerias;
    acc.contatoCoordenador += r.contato_coordenador;
    acc.naoAtuaMercado += r.nao_atua_mercado;
    acc.naoAtuaParcerias += r.nao_atua_parcerias;
    acc.semInteracao += r.sem_interacao;
    acc.emAndamento += r.em_andamento;
    acc.respNoDisparo += r.resp_no_disparo;
    acc.respFup1 += r.resp_fup1;
    acc.respFup2 += r.resp_fup2;
    acc.respFup3 += r.resp_fup3;
    acc.canalLigacao += r.canal_ligacao;
    acc.canalWhatsapp += r.canal_whatsapp;
    acc.canalPessoalmente += r.canal_pessoalmente;
    acc.canalOutro += r.canal_outro;
  }
  return acc;
}

function toKpis(c: TrisulCounts): TrisulKpis {
  const div = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    ...c,
    taxaResposta: div(c.respostas, c.disparos),
    taxaFalha: div(c.falhasEnvio, c.disparos),
    taxaAtivos: div(c.ativosConfirmados, c.respostas),
    conversao: div(c.ativosConfirmados, c.disparos),
    pctAtuam: div(c.atuamParcerias, c.respostas),
    pctContatoCoord: div(c.contatoCoordenador, c.respostas),
  };
}

export async function getTrisulDashboardData(
  range: DateRange,
  filtersIn: TrisulFilters = {},
  periodKey?: PeriodKey,
): Promise<TrisulDashboardData> {
  const [diarioAll, atendimentos] = await Promise.all([
    fetchDiario(),
    fetchAtendimentos(range, filtersIn),
  ]);

  // Dimensões vêm do universo inteiro (pra popular os selects mesmo fora do recorte).
  const dimensions: TrisulDimensions = {
    campanhas: [...new Set(diarioAll.map((r) => r.campanha).filter(Boolean) as string[])].sort(),
    coordenadores: [...new Set(diarioAll.map((r) => r.coordenador_nome).filter(Boolean) as string[])].sort(),
  };
  // Descarta filtros que não existem nas dimensões (defensivo).
  const filters: TrisulFilters = {
    campanha: filtersIn.campanha && dimensions.campanhas.includes(filtersIn.campanha) ? filtersIn.campanha : undefined,
    coordenador: filtersIn.coordenador && dimensions.coordenadores.includes(filtersIn.coordenador) ? filtersIn.coordenador : undefined,
  };

  const filtered = applyDiarioFilters(diarioAll, filters);
  const current = filtered.filter((r) => inRange(r.dia, range));

  const prev = previousRange(range, periodKey);
  const previous = prev ? filtered.filter((r) => inRange(r.dia, prev)) : [];

  const kpis = toKpis(sumCounts(current));
  const kpisPrevious = prev ? toKpis(sumCounts(previous)) : null;

  const deltas: TrisulDeltas | null = kpisPrevious
    ? {
        disparos: computeDelta(kpis.disparos, kpisPrevious.disparos, { kind: "count", orientation: "higher_is_better" }),
        taxaResposta: computeDelta(kpis.taxaResposta, kpisPrevious.taxaResposta, { kind: "percent", orientation: "higher_is_better" }),
        taxaAtivos: computeDelta(kpis.taxaAtivos, kpisPrevious.taxaAtivos, { kind: "percent", orientation: "higher_is_better" }),
        conversao: computeDelta(kpis.conversao, kpisPrevious.conversao, { kind: "percent", orientation: "higher_is_better" }),
        pctAtuam: computeDelta(kpis.pctAtuam, kpisPrevious.pctAtuam, { kind: "percent", orientation: "higher_is_better" }),
        pctContatoCoord: computeDelta(kpis.pctContatoCoord, kpisPrevious.pctContatoCoord, { kind: "percent", orientation: "neutral" }),
      }
    : null;

  // Série diária (disparos x respostas), preenchendo lacunas entre min e max.
  const daily = buildDaily(current);

  // Consolidado por status (5 buckets que a view entrega).
  const c = kpis;
  const status: StatusSlice[] = [
    { name: "Confirmados", value: c.ativosConfirmados },
    { name: "Não atua no mercado", value: c.naoAtuaMercado },
    { name: "Não atua com parcerias", value: c.naoAtuaParcerias },
    { name: "Sem interação", value: c.semInteracao },
    { name: "Em andamento", value: c.emAndamento },
  ].map((s) => ({ ...s, color: STATUS_COLORS[s.name] ?? "#6b7280" }));

  // Efetividade do follow-up: qual toque trouxe a resposta.
  const followup: FollowupPoint[] = [
    { name: "No disparo", value: c.respNoDisparo },
    { name: "Follow-up 1", value: c.respFup1 },
    { name: "Follow-up 2", value: c.respFup2 },
    { name: "Follow-up 3", value: c.respFup3 },
  ];

  const canal: CanalSlice[] = [
    { name: "Ligação", value: c.canalLigacao },
    { name: "WhatsApp", value: c.canalWhatsapp },
    { name: "Pessoalmente", value: c.canalPessoalmente },
    { name: "Outro", value: c.canalOutro },
  ].map((s) => ({ ...s, color: CANAL_COLORS[s.name] ?? "#6b7280" }));

  const coordRanking = buildCoordRanking(current);

  // totalNoPeriodo: disparos no recorte SEM filtros (pra empty-state honesto).
  const currentNoFilter = diarioAll.filter((r) => inRange(r.dia, range));
  const totalNoPeriodo = currentNoFilter.reduce((s, r) => s + r.disparos, 0);

  return {
    range,
    previousRange: prev,
    filters,
    dimensions,
    kpis,
    kpisPrevious,
    deltas,
    charts: { daily, status, followup, canal, coordRanking },
    atendimentos,
    totalNoPeriodo,
    fetchedAt: new Date().toISOString(),
  };
}

function buildDaily(rows: TrisulDiarioRow[]): DailyPoint[] {
  if (rows.length === 0) return [];
  const map = new Map<string, { disparos: number; respostas: number }>();
  let min = "9999-99-99";
  let max = "0000-00-00";
  for (const r of rows) {
    const b = map.get(r.dia) ?? { disparos: 0, respostas: 0 };
    b.disparos += r.disparos;
    b.respostas += r.respostas;
    map.set(r.dia, b);
    if (r.dia < min) min = r.dia;
    if (r.dia > max) max = r.dia;
  }
  // Preenche dias vazios entre min e max (continuidade visual).
  const points: DailyPoint[] = [];
  const start = new Date(`${min}T00:00:00Z`);
  const end = new Date(`${max}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const d = new Date(t);
    const dia = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const b = map.get(dia);
    points.push({ dia, disparos: b?.disparos ?? 0, respostas: b?.respostas ?? 0 });
  }
  return points;
}

function buildCoordRanking(rows: TrisulDiarioRow[]): CoordRankRow[] {
  const map = new Map<string, { disparos: number; respostas: number; ativos: number }>();
  for (const r of rows) {
    const key = r.coordenador_nome?.trim() || "Sem coordenador";
    const b = map.get(key) ?? { disparos: 0, respostas: 0, ativos: 0 };
    b.disparos += r.disparos;
    b.respostas += r.respostas;
    b.ativos += r.ativos_confirmados;
    map.set(key, b);
  }
  const div = (a: number, b: number) => (b > 0 ? a / b : 0);
  return [...map.entries()]
    .map(([coordenador, b]) => ({
      coordenador,
      disparos: b.disparos,
      respostas: b.respostas,
      ativos: b.ativos,
      taxaResposta: div(b.respostas, b.disparos),
      conversao: div(b.ativos, b.disparos),
    }))
    .sort((a, b) => b.disparos - a.disparos)
    .slice(0, 15);
}
