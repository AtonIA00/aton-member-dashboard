"use client";

import { useTransition, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PERIOD_LABEL, PERIOD_PRESETS, parsePeriodKey, type PeriodKey } from "@/lib/period";

const ALL_KEYS: PeriodKey[] = [...PERIOD_PRESETS, "custom"];

export function PeriodPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentKey: PeriodKey = parsePeriodKey(searchParams.get("period"));
  const currentFrom = searchParams.get("from") ?? "";
  const currentTo = searchParams.get("to") ?? "";

  // Estado local pra date inputs (só committa quando ambos preenchidos).
  const [from, setFrom] = useState(currentFrom);
  const [to, setTo] = useState(currentTo);

  function nav(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") {
        params.delete(k);
      } else {
        params.set(k, v);
      }
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function onChangeKey(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as PeriodKey;
    if (next === "custom") {
      nav({ period: "custom" });
    } else if (next === "all") {
      nav({ period: null, from: null, to: null });
    } else {
      nav({ period: next, from: null, to: null });
    }
  }

  function onApplyCustom() {
    if (from && to) {
      nav({ period: "custom", from, to });
    }
  }

  return (
    <div className="flex items-center gap-3">
      <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
        Período
      </label>
      <div className="relative">
        <select
          value={currentKey}
          onChange={onChangeKey}
          disabled={isPending}
          className="cursor-pointer appearance-none rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)] py-2 pl-4 pr-9 text-sm font-medium text-[color:var(--foreground)] outline-none transition-colors hover:border-[color:var(--primary)]/40 focus:border-[color:var(--primary)] disabled:opacity-60"
        >
          {ALL_KEYS.map((k) => (
            <option key={k} value={k}>
              {PERIOD_LABEL[k]}
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

      {currentKey === "custom" && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-transparent text-xs text-[color:var(--foreground)] outline-none"
          />
          <span className="text-xs text-[color:var(--muted-foreground)]">até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-transparent text-xs text-[color:var(--foreground)] outline-none"
          />
          <button
            type="button"
            disabled={!from || !to || isPending}
            onClick={onApplyCustom}
            className="ml-1 rounded bg-[color:var(--primary)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      )}

      {isPending && (
        <span className="flex items-center gap-1.5 text-[11px] text-[color:var(--muted-foreground)]">
          <span className="block h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--primary)]/20 border-t-[color:var(--primary)]" />
          Atualizando…
        </span>
      )}
    </div>
  );
}
