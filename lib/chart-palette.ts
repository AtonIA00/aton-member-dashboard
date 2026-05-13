// Paleta Aton para Recharts. Recharts não consegue ler CSS vars diretamente
// (SVG não interpola var() em props como `stroke`/`fill`), então usamos
// valores hex literais aqui. As cores correspondem aos tokens --chart-*
// definidos em globals.css.
//
// Hierarquia por papel — não trocar por outro azul; cada slot tem semântica:
// - PRIMARY: métrica principal (total, série dominante)
// - SECONDARY: segunda métrica (MQL, etc)
// - TERTIARY: terceira métrica (Agendado+, etc)
// - SUCCESS: positivo (MQL Sim, conversões boas)
// - WARNING: alerta (MQL Pendente, atenção)
// - NEUTRAL: linhas de grade, eixos, séries categóricas sem destaque
//
// Para séries categóricas com 6+ valores, completar com o array CATEGORICAL.

export const CHART_COLORS = {
  primary: "#0057ff",   // --aton-blue
  secondary: "#00c2ff", // --aton-blue-cyan
  tertiary: "#003cff",  // --aton-blue-deep
  success: "#10b981",
  warning: "#f59e0b",
  destructive: "#dc2626",
  neutral: "#6b7280",   // slate-500
} as const;

/** Sequência ordenada pra atribuição automática em séries categóricas. */
export const CHART_SEQUENCE: readonly string[] = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.tertiary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  "#8b5cf6", // violet-500 — fallback fora da paleta core, mas em harmonia
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
];

/** Stroke/fill default para grid e eixos. Cinza neutro com transparência
    funciona razoavelmente em ambos os temas (contraste ~4.5:1 em dark e
    ~4:1 em light). Recharts renderiza SVG <text fill="..."> direto,
    sem suporte a CSS vars — por isso valor literal. */
export const CHART_AXIS = {
  grid: "rgba(107, 114, 128, 0.18)",
  axis: "rgba(107, 114, 128, 0.28)",
  cursor: "rgba(0, 87, 255, 0.18)",
  text: "#6b7280",
} as const;
