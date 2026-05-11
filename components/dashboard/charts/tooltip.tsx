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
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  /** Override do label exibido (ex: data formatada DD/MM). */
  labelFormatter?: (label: string | number) => string;
  /** Quando true, exibe a % calculada sobre o total dos slices. */
  showPercent?: boolean;
};

export function AtonTooltip(props: AnyTooltip) {
  const { active, payload, label, labelFormatter, showPercent } = props;
  if (!active || !payload || payload.length === 0) return null;

  const total = showPercent
    ? payload.reduce((s, p) => s + (Number(p.value) || 0), 0)
    : 0;

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
          const pct = total > 0 ? (v / total) * 100 : 0;
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
                {showPercent && total > 0 && (
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
