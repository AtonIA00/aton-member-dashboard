"use client";

import { useMemo, useState, type ReactNode } from "react";

// Filtro LOCAL de tabela detalhada — padrão do repo pra qualquer dashboard.
// Filtra o DATASET INTEIRO no client (antes da paginação) e a tabela pagina o
// resultado, então nunca perde matches em páginas não visíveis. É drill-down
// da lista: NÃO mexe nos KPIs/gráficos acima (que respondem ao filtro global).
//
// Uso:
//   const { filtered, bar } = useTableDrilldown(rows, FIELDS);
//   // renderize {bar} acima da tabela e pagine `filtered`.
//
// Defina FIELDS como constante de módulo (identidade estável) pra o memo valer.

export type DrilldownField<T> = {
  key: string;
  label: string;
  /** Rótulo da opção "todos" (default "Todos"). */
  allLabel?: string;
  /** Valor normalizado da linha pra esse campo ("" = sem valor). */
  get: (row: T) => string;
  /** Opções explícitas (com rótulos). Se ausente, deriva os distintos de `get`. */
  options?: { value: string; label: string }[];
};

export function useTableDrilldown<T>(rows: T[], fields: DrilldownField<T>[]): {
  filtered: T[];
  bar: ReactNode;
} {
  const [selected, setSelected] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const active = fields.filter((f) => selected[f.key]);
    if (active.length === 0) return rows;
    return rows.filter((r) => active.every((f) => f.get(r) === selected[f.key]));
  }, [rows, fields, selected]);

  const fieldOptions = useMemo(() => {
    const m: Record<string, { value: string; label: string }[]> = {};
    for (const f of fields) {
      if (f.options) {
        m[f.key] = f.options;
        continue;
      }
      const distinct = [...new Set(rows.map((r) => f.get(r)).filter(Boolean))].sort();
      m[f.key] = distinct.map((v) => ({ value: v, label: v }));
    }
    return m;
  }, [rows, fields]);

  const anyActive = fields.some((f) => Boolean(selected[f.key]));

  const bar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-2)]/40 px-6 py-3">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
        Filtrar lista
      </span>
      {fields.map((f) => (
        <select
          key={f.key}
          value={selected[f.key] ?? ""}
          onChange={(e) =>
            setSelected((s) => ({ ...s, [f.key]: e.target.value }))
          }
          aria-label={f.label}
          className="cursor-pointer appearance-none rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)] py-1.5 pl-2.5 pr-6 text-xs text-[color:var(--foreground)] outline-none transition-colors hover:border-[color:var(--primary)]/40 focus:border-[color:var(--primary)]"
        >
          <option value="">{f.allLabel ?? "Todos"} · {f.label}</option>
          {(fieldOptions[f.key] ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {anyActive && (
        <button
          type="button"
          onClick={() => setSelected({})}
          className="text-[11px] font-medium text-[color:var(--muted-foreground)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          limpar
        </button>
      )}
    </div>
  );

  return { filtered, bar };
}
