import { getTrisulDashboardData, type TrisulFilters } from "@/lib/trisul";
import { PERIOD_LABEL, resolvePeriod, type PeriodKey } from "@/lib/period";
import { PeriodPicker } from "@/components/dashboard/PeriodPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AtonLogo } from "@/components/brand/AtonLogo";
import { TrisulKpiRow } from "./TrisulKpiRow";
import { TrisulFilterBar } from "./TrisulFilterBar";
import { TrisulTable } from "./TrisulTable";
import {
  TrisulCanalChart,
  TrisulCoordRanking,
  TrisulDailyChart,
  TrisulFollowupChart,
  TrisulStatusChart,
} from "./TrisulCharts";

type HmacParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
  user_name?: string;
  workspace_name?: string;
};

type Props = {
  workspaceName: string;
  periodKey: PeriodKey;
  customFrom?: string;
  customTo?: string;
  filters: TrisulFilters;
  hmac: HmacParams;
  adminView: boolean;
};

function fmtBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function TrisulView({
  workspaceName,
  periodKey,
  customFrom,
  customTo,
  filters,
  hmac,
  adminView,
}: Props) {
  const range = resolvePeriod(periodKey, customFrom, customTo);
  const data = await getTrisulDashboardData(range, filters, periodKey);

  const periodLabel =
    periodKey === "custom" && range.from && range.to
      ? `${fmtBr(range.from)} a ${fmtBr(range.to)}`
      : PERIOD_LABEL[periodKey];
  const filtersActive = Boolean(data.filters.campanha || data.filters.coordenador);

  const periodSummary =
    periodKey === "all"
      ? "Mostrando todo o histórico de reativação."
      : periodKey === "custom" && range.from && range.to
        ? `Mostrando de ${fmtBr(range.from)} até ${fmtBr(range.to)}.`
        : `Mostrando: ${PERIOD_LABEL[periodKey].toLowerCase()}.`;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(50% 40% at 30% 0%, rgba(0, 87, 255, 0.12) 0%, rgba(0, 87, 255, 0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-8 py-8 lg:px-12 lg:py-10">
        {/* Header */}
        <header className="flex flex-col gap-5 border-b border-[color:var(--border)] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <AtonLogo height={18} />
              <span className="text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted-foreground)]">
                · Reativação de parceiros
              </span>
            </div>
            <h1 className="mt-2 truncate font-[family-name:var(--font-montserrat)] text-3xl font-bold leading-tight text-[color:var(--foreground)] sm:text-4xl">
              {workspaceName}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {adminView && (
              <span
                title="Acesso via super-admin"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-[#f59e0b]"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                Admin
              </span>
            )}
            <PeriodPicker />
            <ThemeToggle hmac={hmac} />
          </div>
        </header>

        <p className="mt-4 text-sm text-[color:var(--muted-foreground)]">{periodSummary}</p>

        <TrisulFilterBar dimensions={data.dimensions} totalNoPeriodo={data.totalNoPeriodo} />

        <div className="mt-6">
          <TrisulKpiRow kpis={data.kpis} kpisPrevious={data.kpisPrevious} deltas={data.deltas} />
        </div>

        {data.totalNoPeriodo === 0 ? (
          <div className="mt-10 rounded-[var(--radius-lg)] border border-dashed border-[color:var(--border)] bg-[color:var(--card)]/40 p-12 text-center backdrop-blur">
            <div className="font-[family-name:var(--font-montserrat)] text-base font-semibold text-[color:var(--foreground)]">
              Nenhum disparo nesse período
            </div>
            <p className="mx-auto mt-2 max-w-md text-sm text-[color:var(--muted-foreground)]">
              Tente um intervalo maior no dropdown acima, ou aguarde as próximas ondas de reativação.
            </p>
          </div>
        ) : (
          <>
            <section aria-label="Análise" className="mt-10">
              <div className="mb-4 flex items-center gap-2">
                <span aria-hidden className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]" />
                <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
                  Análise
                </h2>
              </div>

              <div>
                <TrisulDailyChart data={data.charts.daily} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <TrisulStatusChart data={data.charts.status} />
                <TrisulCanalChart data={data.charts.canal} />
                <TrisulFollowupChart data={data.charts.followup} />
              </div>

              <div className="mt-4">
                <TrisulCoordRanking data={data.charts.coordRanking} />
              </div>
            </section>

            <div className="mt-8">
              <TrisulTable
                atendimentos={data.atendimentos}
                periodLabel={periodLabel}
                filtersActive={filtersActive}
              />
            </div>
          </>
        )}

        <div className="mt-auto pt-10 text-center text-[11px] text-[color:var(--muted-foreground)]">
          <span className="font-mono">member-dashboard.aton-ia.com.br</span>
          <span className="mx-2 opacity-50">·</span>
          <span>Aton IA · Trisul Parcerias</span>
        </div>
      </div>
    </main>
  );
}
