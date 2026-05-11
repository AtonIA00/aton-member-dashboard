// Resolução de presets de período pro dropdown do dashboard.
// Datas em ISO YYYY-MM-DD (timezone-agnostic) — comparação por string
// contra o campo `data` da terrace360 (que vem como timestamptz mas só
// usamos a parte de data).
//
// Decisão: comparação client-side em UTC. A coluna `data` na terrace360 vem
// como "2026-05-11 00:00:00+00" — sempre meia-noite UTC. Comparar com
// strings YYYY-MM-DD funciona pra todos os presets sem timezone math.

export type PeriodKey =
  | "all"
  | "today"
  | "yesterday"
  | "this_month"
  | "last_month"
  | "7d"
  | "30d"
  | "90d"
  | "custom";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  all: "Todo período",
  today: "Hoje",
  yesterday: "Ontem",
  this_month: "Mês atual",
  last_month: "Mês passado",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  custom: "Personalizado",
};

export const PERIOD_PRESETS: PeriodKey[] = [
  "all",
  "today",
  "yesterday",
  "this_month",
  "last_month",
  "7d",
  "30d",
  "90d",
];

export type DateRange = {
  /** YYYY-MM-DD inclusive, ou null pra "sem limite inferior". */
  from: string | null;
  /** YYYY-MM-DD inclusive, ou null pra "sem limite superior". */
  to: string | null;
};

function isoDay(d: Date): string {
  // Sempre formato UTC YYYY-MM-DD (sem horário). Garante consistência com
  // o `data` da terrace360 que vem meia-noite UTC.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parsePeriodKey(v: string | null | undefined): PeriodKey {
  const k = (v ?? "").toLowerCase().trim();
  if ((PERIOD_PRESETS as string[]).includes(k) || k === "custom") {
    return k as PeriodKey;
  }
  return "all";
}

/**
 * Resolve preset → range concreto pra hoje. Datas em UTC.
 * `all` retorna {from: null, to: null} (sem filtro).
 * `custom` retorna {from: null, to: null} se fromIso/toIso não vierem.
 */
export function resolvePeriod(
  key: PeriodKey,
  customFrom?: string,
  customTo?: string,
): DateRange {
  const now = new Date();
  const today = isoDay(now);

  switch (key) {
    case "all":
      return { from: null, to: null };
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = new Date(now);
      y.setUTCDate(y.getUTCDate() - 1);
      const iso = isoDay(y);
      return { from: iso, to: iso };
    }
    case "this_month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: isoDay(first), to: today };
    }
    case "last_month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      return { from: isoDay(first), to: isoDay(last) };
    }
    case "7d": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 6);
      return { from: isoDay(d), to: today };
    }
    case "30d": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 29);
      return { from: isoDay(d), to: today };
    }
    case "90d": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 89);
      return { from: isoDay(d), to: today };
    }
    case "custom": {
      const validFrom = customFrom && /^\d{4}-\d{2}-\d{2}$/.test(customFrom) ? customFrom : null;
      const validTo = customTo && /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : null;
      return { from: validFrom, to: validTo };
    }
  }
}
