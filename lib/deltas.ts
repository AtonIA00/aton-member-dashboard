// Deltas comparativos entre período atual e período anterior.
//
// Cada KPI vira um Delta: direção (up/down/stable), classificação semântica
// (positive/negative/neutral) baseada em orientation (higher_is_better/
// neutral), e texto formatado pronto pra UI.
//
// Threshold de "estável":
// - kind=count:   |Δ%| < 2%  → stable/neutral
// - kind=percent: |ΔPP|  < 1 → stable/neutral
// (PP = pontos percentuais — diferença absoluta entre dois %)

export type DeltaDirection = "up" | "down" | "stable" | "new";
export type DeltaClassification = "positive" | "negative" | "neutral";
export type DeltaKind = "count" | "percent";
export type DeltaOrientation = "higher_is_better" | "lower_is_better" | "neutral";

export type Delta = {
  direction: DeltaDirection;
  /** Valor numérico atual (count ou taxa 0..1). */
  value: number;
  /** Valor numérico do período anterior. */
  valuePrevious: number;
  classification: DeltaClassification;
  /** Texto pronto pra UI ("▲ +12,5%" / "▼ −8,3%" / "— estável" / "Novo"). */
  formatted: string;
};

const COUNT_STABLE_PCT = 2;   // 2%
const PERCENT_STABLE_PP = 1;  // 1 ponto percentual

function fmtSignedPct(deltaPct: number): string {
  const sign = deltaPct > 0 ? "+" : deltaPct < 0 ? "−" : "";
  return sign + Math.abs(deltaPct).toFixed(1).replace(".", ",") + "%";
}

function fmtSignedPP(deltaPP: number): string {
  const sign = deltaPP > 0 ? "+" : deltaPP < 0 ? "−" : "";
  return sign + Math.abs(deltaPP).toFixed(1).replace(".", ",") + " pp";
}

function fmtSignedInt(diff: number): string {
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return sign + Math.abs(diff).toLocaleString("pt-BR");
}

/**
 * Computa o Delta entre current e previous segundo as regras do M8.
 *
 * - kind=count: deltaPct relativo; threshold de estável 2%
 * - kind=percent: deltaPP absoluto (current e previous em 0..1, multiplicados
 *   por 100); threshold de estável 1pp
 * - orientation=neutral: classification sempre 'neutral' (cinza); útil
 *   pra Anúncios/Campanhas onde "mais" não é objetivamente bom.
 */
export function computeDelta(
  current: number,
  previous: number,
  opts: { kind: DeltaKind; orientation: DeltaOrientation },
): Delta {
  // Caso "novo período" — não havia base no anterior pra comparar.
  if (previous === 0 && current > 0) {
    return {
      direction: "new",
      value: current,
      valuePrevious: 0,
      classification: "neutral",
      formatted: "Novo · sem referência",
    };
  }
  // Ambos zerados — sem mudança.
  if (previous === 0 && current === 0) {
    return {
      direction: "stable",
      value: current,
      valuePrevious: previous,
      classification: "neutral",
      formatted: "— sem dados",
    };
  }

  // Threshold + cálculo conforme kind.
  let direction: DeltaDirection;
  let formatted: string;

  if (opts.kind === "percent") {
    // current/previous em 0..1; converter pra pp.
    const deltaPP = (current - previous) * 100;
    if (Math.abs(deltaPP) < PERCENT_STABLE_PP) {
      direction = "stable";
      formatted = "— estável";
    } else {
      direction = deltaPP > 0 ? "up" : "down";
      formatted =
        (direction === "up" ? "▲ " : "▼ ") +
        fmtSignedPP(deltaPP);
    }
  } else {
    const deltaPct = ((current - previous) / previous) * 100;
    if (Math.abs(deltaPct) < COUNT_STABLE_PCT) {
      direction = "stable";
      formatted = "— estável";
    } else {
      direction = deltaPct > 0 ? "up" : "down";
      // Pra orientation=neutral (Anúncios/Campanhas), exibir DIFF absoluto
      // ("+1 vs ant.") em vez de %. Mais informativo pra pequenos números.
      if (opts.orientation === "neutral") {
        const diff = current - previous;
        formatted = fmtSignedInt(diff) + " vs ant.";
      } else {
        formatted =
          (direction === "up" ? "▲ " : "▼ ") + fmtSignedPct(deltaPct);
      }
    }
  }

  let classification: DeltaClassification;
  if (direction === "stable") {
    classification = "neutral";
  } else if (opts.orientation === "neutral") {
    classification = "neutral";
  } else if (opts.orientation === "lower_is_better") {
    // Ex: taxa de falha de envio — cair é bom (verde), subir é ruim (vermelho).
    classification = direction === "down" ? "positive" : "negative";
  } else {
    // higher_is_better
    classification = direction === "up" ? "positive" : "negative";
  }

  return {
    direction,
    value: current,
    valuePrevious: previous,
    classification,
    formatted,
  };
}
