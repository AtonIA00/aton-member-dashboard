import { classify, GRUPO_LABEL, type Grupo } from "./classify";
import type { LeadRow } from "./leads";

// Filtros avançados do dashboard. Espelhados em URL params pra deep-linking
// e persistência sem state local. Default ausente em todos os campos = "Todos".
//
// Decisões já fechadas (INSTRUCAO_MARCO_4.md):
// - Filtros aplicados in-memory sobre os leads já fetchados (sem novo
//   round-trip ao DB). Cache 60s do getDashboardData() cobre.
// - "Sem canal"/"Sem campanha"/"Sem ID"/"Sem MQL" são valores SELECIONÁVEIS,
//   não escondidos. Cada um vira uma chave estável: "sem_canal", "sem_campanha",
//   etc.

export type MqlValue = "sim" | "nao" | "vazio";
export type EtapaKey =
  | "novo"
  | "em_conversa"
  | "agendado_mais"
  | "descartado"
  | "outros";

export type Filters = {
  campanha?: string;       // nome_campanha exato, ou "sem_campanha"
  anuncio?: string;        // id_anuncio exato, ou "sem_id"
  canal?: string;          // "facebook"|"instagram"|"whatsapp"|"sem_canal"|outros (lowercased)
  estado?: string;         // sigla UF (ex: "SC"), ou "sem_estado"
  cidade?: string;         // nome cidade, ou "sem_cidade"
  mql?: MqlValue;
  etapa?: EtapaKey;
};

const ALL_FILTER_KEYS = [
  "campanha",
  "anuncio",
  "canal",
  "estado",
  "cidade",
  "mql",
  "etapa",
] as const;

const ETAPA_GROUP_MAP: Record<EtapaKey, Grupo> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  agendado_mais: "Agendado+",
  descartado: "Descartado",
  outros: "Outros",
};

export const ETAPA_LABEL: Record<EtapaKey, string> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  // Exibido como "Convertido" (mapeado via GRUPO_LABEL). A chave/valor internos
  // do grupo seguem "Agendado+" — ver lib/classify.ts.
  agendado_mais: GRUPO_LABEL["Agendado+"],
  descartado: "Descartado",
  outros: "Outros",
};

export const MQL_LABEL: Record<MqlValue, string> = {
  sim: "Sim",
  nao: "Não",
  vazio: "Sem MQL",
};

// Sentinelas pra "sem valor" — texto seguro em URL e fácil de identificar.
export const SENTINEL = {
  CAMPANHA: "sem_campanha",
  ANUNCIO: "sem_id",
  CANAL: "sem_canal",
  ESTADO: "sem_estado",
  CIDADE: "sem_cidade",
} as const;

/**
 * Apelidos que o pipeline grava pro MESMO canal. Sem isso o filtro lista
 * "facebook" e "fb" como opções separadas e reparte os leads entre as duas.
 * Medido em 2026-08-10: facebook 4.747 + fb 141 · instagram 3.573 +
 * Instagram 356 + ig 202. (A variação de caixa já era resolvida pelo
 * toLowerCase abaixo — o problema eram só as abreviações.)
 */
const CANAL_ALIAS: Record<string, string> = {
  fb: "facebook",
  face: "facebook",
  ig: "instagram",
  insta: "instagram",
  wpp: "whatsapp",
  zap: "whatsapp",
};

/** Normaliza valor de canal: NULL/"" → "sem_canal"; resto → lower+trim, com
 *  apelidos (fb→facebook, ig→instagram) colapsados no canal canônico. */
export function normalizeCanal(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "") return SENTINEL.CANAL;
  return CANAL_ALIAS[v] ?? v;
}

/** Idem pra campos textuais opcionais: usa sentinela quando NULL/"". */
export function normalizeOrSentinel(
  value: string | null | undefined,
  sentinel: string,
): string {
  const v = (value ?? "").trim();
  return v === "" ? sentinel : v;
}

/**
 * Lê filtros de uma URLSearchParams. Valores em branco/desconhecidos viram
 * undefined (= filtro desligado).
 *
 * Validação semântica (ex: campanha existe nas dimensoes do workspace) é
 * feita depois via dropInvalidFilters — não aqui.
 */
export function parseFilters(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): Filters {
  const get = (k: string): string | undefined => {
    if (params instanceof URLSearchParams) {
      const v = params.get(k);
      return v == null || v === "" ? undefined : v;
    }
    const v = params[k];
    if (Array.isArray(v)) return v[0] || undefined;
    return v && v !== "" ? v : undefined;
  };

  const mqlRaw = get("mql");
  const mql: MqlValue | undefined =
    mqlRaw === "sim" || mqlRaw === "nao" || mqlRaw === "vazio" ? mqlRaw : undefined;

  const etapaRaw = get("etapa");
  const etapa: EtapaKey | undefined =
    etapaRaw && etapaRaw in ETAPA_GROUP_MAP ? (etapaRaw as EtapaKey) : undefined;

  return {
    campanha: get("campanha"),
    anuncio: get("anuncio"),
    canal: get("canal"),
    estado: get("estado"),
    cidade: get("cidade"),
    mql,
    etapa,
  };
}

/**
 * Serializa filtros pra URLSearchParams — undefined/vazio é omitido.
 * Preserva quaisquer outros params já presentes (typicamente HMAC + period).
 */
export function serializeFilters(
  filters: Filters,
  base?: URLSearchParams,
): URLSearchParams {
  const out = new URLSearchParams(base?.toString() ?? "");
  for (const k of ALL_FILTER_KEYS) {
    const v = filters[k];
    if (v && String(v).length > 0) {
      out.set(k, String(v));
    } else {
      out.delete(k);
    }
  }
  return out;
}

/**
 * Remove filtros cujo valor não existe nas dimensões disponíveis do recorte.
 * Edge case do spec: URL com ?campanha=DoesNotExist → ignorar silenciosamente.
 *
 * Loga warning server-side com o motivo, pra observabilidade.
 */
export function dropInvalidFilters(
  filters: Filters,
  dimensions: {
    campanhas: string[];
    anuncios: Array<{ id: string }>;
    canais: string[];
    estados: string[];
    cidades: Array<{ nome: string }>;
  },
  workspaceId: string,
): Filters {
  const clean: Filters = { ...filters };
  const dropped: string[] = [];

  if (clean.campanha && !dimensions.campanhas.includes(clean.campanha)) {
    dropped.push(`campanha=${clean.campanha}`);
    delete clean.campanha;
  }
  if (clean.anuncio && !dimensions.anuncios.some((a) => a.id === clean.anuncio)) {
    dropped.push(`anuncio=${clean.anuncio}`);
    delete clean.anuncio;
  }
  if (clean.canal && !dimensions.canais.includes(clean.canal)) {
    dropped.push(`canal=${clean.canal}`);
    delete clean.canal;
  }
  if (clean.estado && !dimensions.estados.includes(clean.estado)) {
    dropped.push(`estado=${clean.estado}`);
    delete clean.estado;
  }
  if (clean.cidade && !dimensions.cidades.some((c) => c.nome === clean.cidade)) {
    dropped.push(`cidade=${clean.cidade}`);
    delete clean.cidade;
  }

  if (dropped.length > 0) {
    console.warn("[filters] dropping invalid filters", {
      workspaceId,
      dropped,
    });
  }

  return clean;
}

/** True se pelo menos um filtro está ativo. */
export function hasAnyFilter(filters: Filters): boolean {
  return ALL_FILTER_KEYS.some((k) => Boolean(filters[k]));
}

/**
 * Aplica filtros à lista de leads. Mantém a ordem original (já vem ordenada
 * por data desc do agregador). Não muta o array de entrada.
 *
 * Implementação O(N) com um único pass — Cleide stress (1818) leva < 5ms
 * benchmark local.
 */
export function applyFilters(leads: LeadRow[], filters: Filters): LeadRow[] {
  if (!hasAnyFilter(filters)) return leads;

  const filterEtapaGrupo: Grupo | undefined = filters.etapa
    ? ETAPA_GROUP_MAP[filters.etapa]
    : undefined;

  return leads.filter((l) => {
    if (filters.campanha) {
      const c = normalizeOrSentinel(l.nome_campanha, SENTINEL.CAMPANHA);
      if (c !== filters.campanha) return false;
    }
    if (filters.anuncio) {
      const a = normalizeOrSentinel(l.id_anuncio, SENTINEL.ANUNCIO);
      if (a !== filters.anuncio) return false;
    }
    if (filters.canal) {
      if (normalizeCanal(l.canal_campanha) !== filters.canal) return false;
    }
    if (filters.estado) {
      const e = normalizeOrSentinel(l.estado_campanha, SENTINEL.ESTADO);
      if (e !== filters.estado) return false;
    }
    if (filters.cidade) {
      const c = normalizeOrSentinel(l.cidade_campanha, SENTINEL.CIDADE);
      if (c !== filters.cidade) return false;
    }
    if (filters.mql) {
      const v = (l.mql ?? "").toLowerCase().trim();
      if (filters.mql === "sim" && v !== "sim") return false;
      if (filters.mql === "nao" && v !== "não" && v !== "nao") return false;
      if (filters.mql === "vazio" && v !== "") return false;
    }
    if (filterEtapaGrupo) {
      if (classify(l.etapa_funil) !== filterEtapaGrupo) return false;
    }
    return true;
  });
}

// Tipo das dimensões disponíveis no recorte de período (antes dos filtros).
// Usado pra popular o FilterBar.
export type Dimensions = {
  campanhas: string[];
  anuncios: Array<{
    id: string;        // id_anuncio (ou "sem_id")
    campanha: string;  // nome_campanha original do anúncio (ou "sem_campanha") — pra cascade
    count: number;
  }>;
  canais: string[];
  estados: string[];
  cidades: Array<{
    nome: string;
    estado: string; // pra cascade
  }>;
};

/**
 * Calcula as dimensões a partir dos leads do recorte de período
 * (SEM filtros aplicados). Usado pra popular os dropdowns do FilterBar.
 *
 * Cascade depende de saber pra cada anúncio qual sua campanha, e pra cada
 * cidade qual seu estado — por isso anuncios/cidades não são listas simples.
 */
export function computeDimensions(leads: LeadRow[]): Dimensions {
  // Campanhas com count desc.
  const campCount = new Map<string, number>();
  for (const l of leads) {
    const k = normalizeOrSentinel(l.nome_campanha, SENTINEL.CAMPANHA);
    campCount.set(k, (campCount.get(k) ?? 0) + 1);
  }
  const campanhas = [...campCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  // Anúncios — pra cada anúncio, conta + campanha "predominante" (a primeira
  // que aparece num lead daquele anúncio é suficiente: na prática, um anúncio
  // tem apenas uma campanha; mas defensivamente usamos a primeira).
  const adsMap = new Map<string, { campanha: string; count: number }>();
  for (const l of leads) {
    const id = normalizeOrSentinel(l.id_anuncio, SENTINEL.ANUNCIO);
    const camp = normalizeOrSentinel(l.nome_campanha, SENTINEL.CAMPANHA);
    const cur = adsMap.get(id);
    if (cur) {
      cur.count++;
    } else {
      adsMap.set(id, { campanha: camp, count: 1 });
    }
  }
  const anuncios = [...adsMap.entries()]
    .map(([id, v]) => ({ id, campanha: v.campanha, count: v.count }))
    .sort((a, b) => {
      // "Sem ID" no topo, depois por count desc.
      if (a.id === SENTINEL.ANUNCIO && b.id !== SENTINEL.ANUNCIO) return -1;
      if (a.id !== SENTINEL.ANUNCIO && b.id === SENTINEL.ANUNCIO) return 1;
      return b.count - a.count;
    });

  // Canais — set sem ordenação alfabética (queremos os "conhecidos" primeiro).
  const KNOWN_CANAIS = ["facebook", "instagram", "whatsapp"];
  const canalSet = new Set<string>();
  for (const l of leads) canalSet.add(normalizeCanal(l.canal_campanha));
  const canais = [
    ...KNOWN_CANAIS.filter((c) => canalSet.has(c)),
    ...[...canalSet].filter((c) => !KNOWN_CANAIS.includes(c) && c !== SENTINEL.CANAL).sort(),
    ...(canalSet.has(SENTINEL.CANAL) ? [SENTINEL.CANAL] : []),
  ];

  // Estados — alfabético.
  const estSet = new Set<string>();
  for (const l of leads) estSet.add(normalizeOrSentinel(l.estado_campanha, SENTINEL.ESTADO));
  const estados = [...estSet].sort((a, b) => {
    if (a === SENTINEL.ESTADO && b !== SENTINEL.ESTADO) return 1;
    if (a !== SENTINEL.ESTADO && b === SENTINEL.ESTADO) return -1;
    return a.localeCompare(b);
  });

  // Cidades — por (nome, estado). Pra cascade.
  const cidMap = new Map<string, string>(); // nome → estado
  for (const l of leads) {
    const nome = normalizeOrSentinel(l.cidade_campanha, SENTINEL.CIDADE);
    const est = normalizeOrSentinel(l.estado_campanha, SENTINEL.ESTADO);
    if (!cidMap.has(nome)) cidMap.set(nome, est);
  }
  const cidades = [...cidMap.entries()]
    .map(([nome, estado]) => ({ nome, estado }))
    .sort((a, b) => {
      if (a.nome === SENTINEL.CIDADE && b.nome !== SENTINEL.CIDADE) return 1;
      if (a.nome !== SENTINEL.CIDADE && b.nome === SENTINEL.CIDADE) return -1;
      return a.nome.localeCompare(b.nome);
    });

  return { campanhas, anuncios, canais, estados, cidades };
}

// Helper de label legível pra UI a partir do valor cru/sentinela.
export function labelFromValue(value: string, kind: keyof typeof SENTINEL): string {
  switch (value) {
    case SENTINEL.CAMPANHA:
      return "Sem campanha";
    case SENTINEL.ANUNCIO:
      return "Sem ID";
    case SENTINEL.CANAL:
      return "Sem canal";
    case SENTINEL.ESTADO:
      return "Sem estado";
    case SENTINEL.CIDADE:
      return "Sem cidade";
  }
  if (kind === "CANAL") {
    // Grafia oficial dos canais conhecidos; o resto só ganha a inicial
    // maiúscula (capitalizar genérico virava "Whatsapp").
    const OFICIAL: Record<string, string> = {
      facebook: "Facebook",
      instagram: "Instagram",
      whatsapp: "WhatsApp",
    };
    return OFICIAL[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}
