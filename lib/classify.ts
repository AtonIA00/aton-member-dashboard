// Taxonomia canônica de etapas do funil (INSTRUCAO_CLAUDE_CODE.md §
// "Taxonomia de etapas"). A coluna `etapa_funil` em terrace360_leads_atonhub
// tem capitalização inconsistente em produção — sempre normalizar com
// .toLowerCase().trim() antes de comparar.

export type Grupo = "Novo" | "Em conversa" | "Agendado+" | "Descartado" | "Outros";

// Rótulo de EXIBIÇÃO por grupo. Separado do VALOR interno do Grupo — este
// permanece "Agendado+" (taxonomia canônica da METODOLOGIA, usado como chave
// em Records/comparações e nos filtros). A pedido do CEO (jun/2026), o grupo
// "Agendado+" passa a ser EXIBIDO como "Convertido" em todo o produto (KPIs,
// funil, filtros, gráficos e respostas do TON). Único ponto pra trocar o
// texto visível — não tocar nos valores de Grupo acima.
export const GRUPO_LABEL: Record<Grupo, string> = {
  Novo: "Novo",
  "Em conversa": "Em conversa",
  "Agendado+": "Convertido",
  Descartado: "Descartado",
  Outros: "Outros",
};

// Opções canônicas de status pro editor do super-admin (dropdown agrupado).
// `value` é o que grava no banco — DEVE bater com o vocabulário do classify()
// (que compara em minúsculas): "Negociacao" sem acento (classify tem
// "negociacao"). `label` é o texto exibido. `grupo` alimenta o optgroup
// (exibido via GRUPO_LABEL, ex.: "Convertido").
export const STATUS_OPTIONS: { grupo: Grupo; label: string; value: string }[] = [
  { grupo: "Novo", label: "Novo Lead", value: "Novo Lead" },
  { grupo: "Em conversa", label: "Está no script", value: "Está no script" },
  // Label "Convertido" a pedido do Murillo (UI não mostra "Agendado"); value
  // segue "Agendado" — é o que grava no banco e o que classify() reconhece.
  { grupo: "Agendado+", label: "Convertido", value: "Agendado" },
  { grupo: "Agendado+", label: "Especialista", value: "Especialista" },
  { grupo: "Agendado+", label: "Negociação", value: "Negociacao" },
  { grupo: "Agendado+", label: "Financeiro", value: "Financeiro" },
  { grupo: "Descartado", label: "Não se interessou", value: "Não se interessou" },
  { grupo: "Descartado", label: "Lead desqualificado", value: "Lead desqualificado" },
  { grupo: "Descartado", label: "Corretor de imóveis", value: "Corretor de imóveis" },
  { grupo: "Descartado", label: "Lead quer outro imóvel", value: "Lead quer outro imóvel" },
  { grupo: "Descartado", label: "Lead sem interesse", value: "Lead sem interesse" },
];

const SET_AGENDADO_PLUS = new Set([
  "agendado",
  "especialista",
  "negociacao",
  "financeiro",
]);

const SET_DESCARTADO = new Set([
  "não se interessou",
  "lead desqualificado",
  "lead sem interesse",
  "lead quer outro imóvel",
  "outro imóvel",
  "corretor de imóveis",
  "corretor de imoveis",
]);

export function classify(etapaFunil: string | null | undefined): Grupo {
  const e = (etapaFunil ?? "").toLowerCase().trim();
  if (!e) return "Outros";
  if (e === "novo lead") return "Novo";
  if (e === "está no script") return "Em conversa";
  if (SET_AGENDADO_PLUS.has(e)) return "Agendado+";
  if (SET_DESCARTADO.has(e)) return "Descartado";
  return "Outros";
}

// Cor por grupo (paleta Aton v2). Valores hex literais porque Recharts SVG
// não interpola var() em atributos `fill`/`stroke`.
export const GRUPO_COLOR: Record<Grupo, string> = {
  Novo: "#0057ff",        // aton-blue (primary)
  "Em conversa": "#00c2ff", // aton-blue-cyan (secundária)
  "Agendado+": "#10b981", // success
  Descartado: "#dc2626",  // destructive
  Outros: "#6b7280",      // neutro
};

// Cor de fundo (chip) e cor de texto por grupo — usado em chips/badges
// da tabela detalhada. Aqui CSS vars FUNCIONAM (HTML/CSS, não SVG attrs).
// Fundos com transparência leve pra contrastar em ambos os temas.
export const GRUPO_CHIP: Record<Grupo, { bg: string; text: string; border: string }> = {
  Novo: {
    bg: "rgba(0, 87, 255, 0.10)",
    text: "#0057ff",
    border: "rgba(0, 87, 255, 0.30)",
  },
  "Em conversa": {
    bg: "rgba(0, 194, 255, 0.10)",
    text: "#00aee8",
    border: "rgba(0, 194, 255, 0.30)",
  },
  "Agendado+": {
    bg: "rgba(16, 185, 129, 0.10)",
    text: "#10b981",
    border: "rgba(16, 185, 129, 0.30)",
  },
  Descartado: {
    bg: "rgba(220, 38, 38, 0.10)",
    text: "#dc2626",
    border: "rgba(220, 38, 38, 0.30)",
  },
  Outros: {
    bg: "rgba(107, 114, 128, 0.10)",
    text: "var(--muted-foreground)",
    border: "rgba(107, 114, 128, 0.25)",
  },
};
