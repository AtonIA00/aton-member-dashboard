"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TrisulDimensions } from "@/lib/trisul";

type Props = {
  dimensions: TrisulDimensions;
  totalNoPeriodo: number;
};

export function TrisulFilterBar({ dimensions, totalNoPeriodo }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const campanha = sp.get("campanha") ?? "";
  const coordenador = sp.get("coordenador") ?? "";

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function clearAll() {
    const params = new URLSearchParams(sp.toString());
    params.delete("campanha");
    params.delete("coordenador");
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  if (totalNoPeriodo === 0) return null;

  const someActive = Boolean(campanha || coordenador);

  return (
    <section
      aria-label="Filtros"
      className="mt-6 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/50 px-5 py-4 backdrop-blur"
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Select
          label="Campanha"
          value={campanha}
          onChange={(v) => setParam("campanha", v)}
          options={[{ value: "", label: "Todas" }, ...dimensions.campanhas.map((c) => ({ value: c, label: c }))]}
          minWidth="12rem"
        />
        <Select
          label="Coordenador"
          value={coordenador}
          onChange={(v) => setParam("coordenador", v)}
          options={[{ value: "", label: "Todos" }, ...dimensions.coordenadores.map((c) => ({ value: c, label: c }))]}
          minWidth="14rem"
        />
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
          <span className="self-end pb-2 text-[11px] text-[color:var(--muted-foreground)]">Atualizando…</span>
        )}
      </div>
    </section>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  minWidth,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  minWidth?: string;
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
          className="w-full cursor-pointer appearance-none rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)] py-2 pl-3 pr-8 text-sm text-[color:var(--foreground)] outline-none transition-colors hover:border-[color:var(--primary)]/40 focus:border-[color:var(--primary)]"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]">
          ▾
        </span>
      </div>
    </label>
  );
}
