"use client";

import type { TooltipProps } from "recharts";

/**
 * Tooltip Recharts customizado com a estética Aton (bg2 + border ciano +
 * texto foreground). Suporta dois modos:
 *
 * - Default: lista todos os valores do ponto com nome:valor.
 * - "value-with-pct": passa o array completo no payload pra calcular % do
 *   total (útil pra MQL donut).
 */
type AnyTooltip = TooltipProps<number, string> & {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    /** Recharts injeta `percent` (0..1) nas fatias de Pie — usamos direto. */
    percent?: number;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  /** Override do label exibido (ex: data formatada DD/MM). */
  labelFormatter?: (label: string | number) => string;
  /** Quando true, exibe a % da fatia. */
  showPercent?: boolean;
  /** Total do universo pra calcular a % (charts de BARRA passam explícito —
   *  no Pie o recharts já dá `percent` por fatia). */
  percentTotal?: number;
};

export function AtonTooltip(props: AnyTooltip) {
  const { active, payload, label, labelFormatter, showPercent, percentTotal } = props;
  if (!active || !payload || payload.length === 0) return null;

  // Base pra % quando não vier o `percent` do recharts (caso Pie): usa o total
  // explícito passado pelo chart de barra, senão a soma do payload (fallback).
  // ⚠️ Em Pie, o payload traz só a fatia sob o cursor — somar o payload daria
  // sempre 100% (bug antigo). Por isso preferimos p.percent.
  const total = showPercent
    ? (typeof percentTotal === "number" && percentTotal > 0
        ? percentTotal
        : payload.reduce((s, p) => s + (Number(p.value) || 0), 0))
    : 0;

  function slicePct(p: { value?: number; percent?: number }): number {
    if (typeof p.percent === "number" && Number.isFinite(p.percent)) return p.percent * 100;
    const v = Number(p.value) || 0;
    return total > 0 ? (v / total) * 100 : 0;
  }

  const displayLabel = label != null
    ? labelFormatter
      ? labelFormatter(label)
      : String(label)
    : null;

  return (
    <div
      className="rounded-md border border-[color:var(--border)] bg-[color:var(--card)]/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
      style={{ minWidth: "8rem" }}
    >
      {displayLabel && (
        <div className="mb-1 font-[family-name:var(--font-montserrat)] text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          {displayLabel}
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {payload.map((p, i) => {
          const v = Number(p.value) || 0;
          const pct = slicePct(p);
          const showPct = showPercent && (typeof p.percent === "number" || total > 0);
          return (
            <li key={i} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
                aria-hidden
              />
              <span className="text-[color:var(--muted-foreground)]">
                {p.name}:
              </span>
              <span className="ml-auto font-semibold text-[color:var(--foreground)] tabular-nums">
                {v.toLocaleString("pt-BR")}
                {showPct && (
                  <span className="ml-1 text-[color:var(--muted-foreground)]">
                    ({pct.toFixed(1).replace(".", ",")}%)
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
