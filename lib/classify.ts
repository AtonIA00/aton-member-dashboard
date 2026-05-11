// Taxonomia canônica de etapas do funil (INSTRUCAO_CLAUDE_CODE.md §
// "Taxonomia de etapas"). A coluna `etapa_funil` em terrace360_leads_atonhub
// tem capitalização inconsistente em produção — sempre normalizar com
// .toLowerCase().trim() antes de comparar.

export type Grupo = "Novo" | "Em conversa" | "Agendado+" | "Descartado" | "Outros";

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

// Cor por grupo (token CSS do design system Aton).
export const GRUPO_COLOR: Record<Grupo, string> = {
  Novo: "var(--primary)",       // ciano
  "Em conversa": "#4FC3F7",     // azul-claro
  "Agendado+": "#69F0AE",       // verde
  Descartado: "var(--destructive)", // vermelho
  Outros: "var(--muted-foreground)",
};

// Cor de fundo (chip) e cor de texto por grupo — usado em chips/badges
// da tabela detalhada.
export const GRUPO_CHIP: Record<Grupo, { bg: string; text: string; border: string }> = {
  Novo: {
    bg: "rgba(0, 229, 255, 0.12)",
    text: "var(--primary)",
    border: "rgba(0, 229, 255, 0.35)",
  },
  "Em conversa": {
    bg: "rgba(79, 195, 247, 0.12)",
    text: "#4FC3F7",
    border: "rgba(79, 195, 247, 0.35)",
  },
  "Agendado+": {
    bg: "rgba(105, 240, 174, 0.12)",
    text: "#69F0AE",
    border: "rgba(105, 240, 174, 0.35)",
  },
  Descartado: {
    bg: "rgba(255, 82, 82, 0.12)",
    text: "var(--destructive)",
    border: "rgba(255, 82, 82, 0.35)",
  },
  Outros: {
    bg: "rgba(136, 153, 170, 0.10)",
    text: "var(--muted-foreground)",
    border: "rgba(136, 153, 170, 0.25)",
  },
};
