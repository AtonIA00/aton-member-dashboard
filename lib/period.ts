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

// ──────────────────────────────────────────────────────────────────────────
// Período anterior (M8 — comparativo)

function parseIsoDay(iso: string): Date {
  // Cria Date UTC à meia-noite — consistente com `data` da terrace360.
  return new Date(
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10)),
    ),
  );
}

function daysBetween(from: string, to: string): number {
  // Quantos DIAS (inclusive) o range cobre — de YYYY-MM-DD a YYYY-MM-DD.
  const a = parseIsoDay(from).getTime();
  const b = parseIsoDay(to).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

function shiftDays(iso: string, deltaDays: number): string {
  const d = parseIsoDay(iso);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return isoDay(d);
}

/**
 * Computa o período ANTERIOR ao recorte atual pra comparativo.
 * Retorna null pra `all` (sem referência comparável).
 *
 * Regras (acordadas no spec M8):
 * - Hoje → Ontem (1 dia)
 * - Ontem → Anteontem (1 dia)
 * - Mês atual PARCIAL (ex: 1-11 mai) → mesmos dias do mês passado (1-11 abr).
 *   Importante: NÃO mês passado inteiro — distorce absolutos quando estamos
 *   no dia 5 e comparamos com 30 dias.
 * - Mês passado (mês inteiro) → mês retrasado (mês inteiro)
 * - 7d/30d/90d → janela imediatamente anterior, mesma duração
 * - Personalizado (X..Y) → janela de mesma duração imediatamente antes
 * - Todo período → null (UI esconde chips)
 */
export function previousRange(range: DateRange, key?: PeriodKey): DateRange | null {
  // Sem limite → sem comparativo.
  if (!range.from || !range.to) return null;

  // Mês passado completo → mês retrasado COMPLETO (mesmo número de dias do
  // retrasado, não da duração do passado). Preserva semântica "mês a mês".
  if (key === "last_month") {
    const fromD = parseIsoDay(range.from);
    const prevYear = fromD.getUTCFullYear();
    const prevMonth = fromD.getUTCMonth() - 1; // mês retrasado
    const prevFrom = new Date(Date.UTC(prevYear, prevMonth, 1));
    const lastDay = new Date(Date.UTC(prevYear, prevMonth + 1, 0));
    return { from: isoDay(prevFrom), to: isoDay(lastDay) };
  }

  // Mês atual parcial — caso especial: comparar com os mesmos dias do mês
  // anterior. Detectado por: from é dia 1 E to é hoje (estamos no mês corrente).
  // Robusto ao não-passagem de `key`: derivamos do shape do range.
  if (key === "this_month") {
    const fromD = parseIsoDay(range.from);
    const toD = parseIsoDay(range.to);
    // Mês anterior, mesmo dia inicial (1) e mesmo dia final.
    const prevFromY = fromD.getUTCFullYear();
    const prevFromM = fromD.getUTCMonth() - 1;
    const prevTo = new Date(Date.UTC(prevFromY, prevFromM, toD.getUTCDate()));
    // Se mês anterior não tem aquele dia (ex: 31 jan vs fev=28), trunca pro
    // último dia do mês anterior.
    const lastDayOfPrevMonth = new Date(Date.UTC(prevFromY, prevFromM + 1, 0)).getUTCDate();
    const prevToDay = Math.min(toD.getUTCDate(), lastDayOfPrevMonth);
    const prevFrom = new Date(Date.UTC(prevFromY, prevFromM, 1));
    const prevToFinal = new Date(Date.UTC(prevFromY, prevFromM, prevToDay));
    return { from: isoDay(prevFrom), to: isoDay(prevToFinal) };
  }

  // Default: janela imediatamente anterior com mesma duração.
  // (Cobre today→yesterday, yesterday→anteontem, 7d/30d/90d, last_month→
  // antepenúltimo mês, custom→sliding window).
  const dur = daysBetween(range.from, range.to);
  const prevTo = shiftDays(range.from, -1);
  const prevFrom = shiftDays(prevTo, -(dur - 1));
  return { from: prevFrom, to: prevTo };
}
