"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ETAPA_LABEL,
  MQL_LABEL,
  SENTINEL,
  hasAnyFilter,
  labelFromValue,
  parseFilters,
  serializeFilters,
  type Dimensions,
  type EtapaKey,
  type Filters,
  type MqlValue,
} from "@/lib/filters";
import { GRUPO_CHIP, type Grupo } from "@/lib/classify";

type Props = {
  dimensions: Dimensions;
  /** Total de leads no período (antes dos filtros). 0 → bar é ocultada. */
  totalNoPeriodo: number;
};

const ETAPA_TO_GRUPO: Record<EtapaKey, Grupo> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  agendado_mais: "Agendado+",
  descartado: "Descartado",
  outros: "Outros",
};
const ETAPA_KEYS: EtapaKey[] = ["novo", "em_conversa", "agendado_mais", "descartado", "outros"];
const MQL_KEYS: MqlValue[] = ["sim", "nao", "vazio"];

export function FilterBar({ dimensions, totalNoPeriodo }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const filters: Filters = useMemo(
    () => parseFilters(searchParams),
    [searchParams],
  );

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K] | undefined) {
    const next: Filters = { ...filters, [key]: value };
    // Cascateamento: limpar filhos quando o pai muda.
    if (key === "campanha") next.anuncio = undefined;
    if (key === "estado") next.cidade = undefined;
    const params = serializeFilters(next, new URLSearchParams(searchParams.toString()));
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function clearAll() {
    const next: Filters = {};
    const params = serializeFilters(next, new URLSearchParams(searchParams.toString()));
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  // Sem leads no período → não faz sentido mostrar filtros vazios.
  if (totalNoPeriodo === 0) return null;

  // Anúncios disponíveis dado o filtro de Campanha atual (cascade).
  const anunciosDisponiveis = useMemo(() => {
    if (!filters.campanha) return dimensions.anuncios;
    return dimensions.anuncios.filter((a) => a.campanha === filters.campanha);
  }, [dimensions.anuncios, filters.campanha]);

  // Cidades disponíveis dado o filtro de Estado atual (cascade).
  const cidadesDisponiveis = useMemo(() => {
    if (!filters.estado) return dimensions.cidades;
    return dimensions.cidades.filter((c) => c.estado === filters.estado);
  }, [dimensions.cidades, filters.estado]);

  const someActive = hasAnyFilter(filters);

  return (
    <section
      aria-label="Filtros do dashboard"
      className="mt-6 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/50 px-5 py-4 backdrop-blur"
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {/* Campanha */}
        <Select
          label="Campanha"
          value={filters.campanha ?? ""}
          onChange={(v) => setFilter("campanha", v || undefined)}
          options={[
            { value: "", label: "Todas" },
            ...dimensions.campanhas.map((c) => ({
              value: c,
              label: c === SENTINEL.CAMPANHA ? "Sem campanha" : c,
            })),
          ]}
          minWidth="11rem"
        />

        {/* Anúncio — cascateado */}
        <Select
          label="Anúncio"
          value={filters.anuncio ?? ""}
          onChange={(v) => setFilter("anuncio", v || undefined)}
          options={[
            { value: "", label: "Todos" },
            ...anunciosDisponiveis.map((a) => ({
              value: a.id,
              label:
                a.id === SENTINEL.ANUNCIO
                  ? `Sem ID (${a.count})`
                  : `${truncateId(a.id)} (${a.count})`,
            })),
          ]}
          minWidth="14rem"
          disabled={anunciosDisponiveis.length === 0}
        />

        {/* Canal */}
        <Select
          label="Canal"
          value={filters.canal ?? ""}
          onChange={(v) => setFilter("canal", v || undefined)}
          options={[
            { value: "", label: "Todos" },
            ...dimensions.canais.map((c) => ({
              value: c,
              label: labelFromValue(c, "CANAL"),
            })),
          ]}
          minWidth="8.5rem"
        />

        {/* Estado */}
        {dimensions.estados.length > 0 && (
          <Select
            label="Estado"
            value={filters.estado ?? ""}
            onChange={(v) => setFilter("estado", v || undefined)}
            options={[
              { value: "", label: "Todos" },
              ...dimensions.estados.map((e) => ({
                value: e,
                label: e === SENTINEL.ESTADO ? "Sem estado" : e,
              })),
            ]}
            minWidth="7rem"
          />
        )}

        {/* Cidade — cascateada */}
        {dimensions.cidades.length > 0 && (
          <Select
            label="Cidade"
            value={filters.cidade ?? ""}
            onChange={(v) => setFilter("cidade", v || undefined)}
            options={[
              { value: "", label: "Todas" },
              ...cidadesDisponiveis.map((c) => ({
                value: c.nome,
                label: c.nome === SENTINEL.CIDADE ? "Sem cidade" : c.nome,
              })),
            ]}
            minWidth="9rem"
            disabled={cidadesDisponiveis.length === 0}
          />
        )}

        {/* MQL — chips */}
        <ChipGroup
          label="MQL"
          value={filters.mql}
          onChange={(v) => setFilter("mql", v as MqlValue | undefined)}
          options={[
            { value: undefined, label: "Todos" },
            ...MQL_KEYS.map((k) => ({ value: k, label: MQL_LABEL[k] })),
          ]}
        />

        {/* Etapa — chips com cor por grupo */}
        <ChipGroup
          label="Etapa"
          value={filters.etapa}
          onChange={(v) => setFilter("etapa", v as EtapaKey | undefined)}
          options={[
            { value: undefined, label: "Todas" },
            ...ETAPA_KEYS.map((k) => {
              const grupo = ETAPA_TO_GRUPO[k];
              return {
                value: k,
                label: ETAPA_LABEL[k],
                color: GRUPO_CHIP[grupo],
              };
            }),
          ]}
        />

        {/* Limpar — visível só quando há filtros aplicados */}
        {someActive && (
          <button
            type="button"
            onClick={clearAll}
            disabled={isPending}
            className="ml-auto self-end rounded-[var(--radius-md)] border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/5 px-3 py-2 text-xs font-bold uppercase tracking-wide text-[color:var(--destructive)] transition-colors hover:bg-[color:var(--destructive)]/15 disabled:opacity-50"
          >
            Limpar filtros
          </button>
        )}

        {isPending && (
          <span className="self-end pb-2 text-[11px] text-[color:var(--muted-foreground)]">
            Atualizando…
          </span>
        )}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-componentes

function Select({
  label,
  value,
  onChange,
  options,
  minWidth,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  minWidth?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
        {label}
      </span>
      <div className="relative" style={{ minWidth }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full cursor-pointer appearance-none rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)] py-2 pl-3 pr-8 text-sm text-[color:var(--foreground)] outline-none transition-colors hover:border-[color:var(--primary)]/40 focus:border-[color:var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]"
        >
          ▾
        </span>
      </div>
    </label>
  );
}

type ChipOption<T> = {
  value: T | undefined;
  label: string;
  color?: { bg: string; text: string; border: string };
};

function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: ChipOption<T>[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((o, i) => {
          const active = value === o.value;
          const style =
            active && o.color
              ? {
                  backgroundColor: o.color.bg,
                  color: o.color.text,
                  borderColor: o.color.border,
                }
              : active
              ? {
                  backgroundColor: "rgba(0, 229, 255, 0.12)",
                  color: "var(--primary)",
                  borderColor: "rgba(0, 229, 255, 0.45)",
                }
              : undefined;
          return (
            <button
              key={String(o.value) + i}
              type="button"
              onClick={() => onChange(o.value as T | undefined)}
              style={style}
              className={
                "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors " +
                (active
                  ? "shadow-[0_0_0_1px_currentColor_inset]"
                  : "border-[color:var(--border)] bg-transparent text-[color:var(--muted-foreground)] hover:border-[color:var(--primary)]/40 hover:text-[color:var(--foreground)]")
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function truncateId(id: string): string {
  // IDs de anúncio do Meta são 15+ dígitos — mostra prefixo+sufixo.
  if (id.length <= 16) return id;
  return id.slice(0, 8) + "…" + id.slice(-4);
}
