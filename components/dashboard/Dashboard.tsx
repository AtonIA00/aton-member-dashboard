import { getDashboardData } from "@/lib/leads";
import { PERIOD_LABEL, parsePeriodKey, resolvePeriod, type PeriodKey } from "@/lib/period";
import { hasAnyFilter, type Filters } from "@/lib/filters";
import type { Tier } from "@/lib/access";
import { KpiRow } from "./KpiRow";
import { Funnel } from "./Funnel";
import { AdsPerformanceTable } from "./AdsPerformanceTable";
import { LeadsTable } from "./LeadsTable";
import { PeriodPicker } from "./PeriodPicker";
import { TierBadge } from "./TierBadge";
import { FilterBar } from "./FilterBar";
import { DailyVolumeChart } from "./charts/DailyVolumeChart";
import { CampaignVolumeChart } from "./charts/CampaignVolumeChart";
import { MqlDonutChart } from "./charts/MqlDonutChart";
import { StageDistributionChart } from "./charts/StageDistributionChart";

type Props = {
  workspaceId: string;
  workspaceName: string;
  userName: string;
  tier: Tier;
  daysUntilExpiry: number | null;
  hoursUntilExpiry: number | null;
  habilitadoAt: Date | null;
  expiresAt: Date | null;
  periodKey: PeriodKey;
  customFrom?: string;
  customTo?: string;
  filters: Filters;
};

export async function Dashboard({
  workspaceId,
  workspaceName,
  userName,
  tier,
  daysUntilExpiry,
  hoursUntilExpiry,
  habilitadoAt,
  expiresAt,
  periodKey,
  customFrom,
  customTo,
  filters,
}: Props) {
  const range = resolvePeriod(periodKey, customFrom, customTo);
  const data = await getDashboardData(workspaceId, range, filters);

  const periodSummary = formatPeriodSummary(periodKey, range);
  const greeting = userName ? `Olá, ${userName.split(" ")[0]}` : "Olá";
  const filtersActive = hasAnyFilter(data.filters);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(50% 40% at 30% 0%, rgba(0, 229, 255, 0.14) 0%, rgba(0, 229, 255, 0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-8 py-8 lg:px-12 lg:py-10">
        {/* Header */}
        <header className="flex flex-col gap-5 border-b border-[color:var(--border)] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted-foreground)]">
              Aton · Member Dashboard
            </div>
            <h1 className="mt-2 truncate font-[family-name:var(--font-montserrat)] text-3xl font-bold leading-tight text-[color:var(--foreground)] sm:text-4xl">
              {workspaceName}
            </h1>
            <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
              {greeting}. {periodSummary}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <PeriodPicker />
            <TierBadge
              tier={tier}
              daysUntilExpiry={daysUntilExpiry}
              hoursUntilExpiry={hoursUntilExpiry}
              habilitadoAt={habilitadoAt}
              expiresAt={expiresAt}
            />
          </div>
        </header>

        {/* FilterBar — só aparece se tem leads no período */}
        <FilterBar dimensions={data.dimensions} totalNoPeriodo={data.totalNoPeriodo} />

        {/* KPIs */}
        <div className="mt-6">
          <KpiRow kpis={data.kpis} />
        </div>

        {data.totalNoPeriodo === 0 ? (
          // Caso A: período sem nenhum lead.
          <EmptyState
            title="Você ainda não recebeu leads nesse período"
            body="Tente um intervalo maior no dropdown acima. Se acredita que deveria ter leads aqui, fale com a Aton."
          />
        ) : data.kpis.total === 0 && filtersActive ? (
          // Caso B: período tem leads, mas filtros zeraram.
          <EmptyState
            title="Nenhum lead bateu com os filtros selecionados"
            body={`Você tem ${data.totalNoPeriodo.toLocaleString("pt-BR")} ${data.totalNoPeriodo === 1 ? "lead" : "leads"} no período. Limpe os filtros ou ajuste o período pra ver resultados.`}
            highlightActions
          />
        ) : (
          <>
            <div className="mt-8">
              <Funnel steps={data.funnel} />
            </div>
            <div className="mt-8">
              <AdsPerformanceTable rows={data.adsPerformance} />
            </div>

            {/* Análise visual — M5 */}
            <section aria-label="Análise visual" className="mt-10">
              <div className="mb-4 flex items-center gap-2">
                <span aria-hidden className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]" />
                <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
                  Análise visual
                </h2>
              </div>
              {/* Linha 1: 2:1 (line precisa de mais largura) */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <DailyVolumeChart data={data.charts.dailyVolume} />
                </div>
                <div>
                  <MqlDonutChart data={data.charts.mqlDonut} />
                </div>
              </div>
              {/* Linha 2: 1:1 */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CampaignVolumeChart data={data.charts.campaignVolume} />
                <StageDistributionChart data={data.charts.stageDistribution} />
              </div>
            </section>

            <div className="mt-8">
              <LeadsTable leads={data.leads} />
            </div>
          </>
        )}

        <div className="mt-auto pt-10 text-center text-[11px] text-[color:var(--muted-foreground)]">
          <span className="font-mono">member-dashboard.aton-ia.com.br</span>
          <span className="mx-2 opacity-50">·</span>
          <span>Aton IA</span>
          <span className="mx-2 opacity-50">·</span>
          <span className="tabular-nums">fetch {data.fetchMs}ms</span>
          {filtersActive && (
            <>
              <span className="mx-2 opacity-50">·</span>
              <span className="tabular-nums">
                {data.kpis.total.toLocaleString("pt-BR")} de{" "}
                {data.totalNoPeriodo.toLocaleString("pt-BR")} leads após filtros
              </span>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function EmptyState({
  title,
  body,
  highlightActions,
}: {
  title: string;
  body: string;
  highlightActions?: boolean;
}) {
  return (
    <div
      className={
        "mt-10 rounded-[var(--radius-lg)] border border-dashed p-12 text-center backdrop-blur " +
        (highlightActions
          ? "border-[color:var(--primary)]/40 bg-[color:var(--primary)]/5"
          : "border-[color:var(--border)] bg-[color:var(--card)]/40")
      }
    >
      <div className="font-[family-name:var(--font-montserrat)] text-base font-semibold text-[color:var(--foreground)]">
        {title}
      </div>
      <p className="mx-auto mt-2 max-w-md text-sm text-[color:var(--muted-foreground)]">{body}</p>
    </div>
  );
}

function formatPeriodSummary(key: PeriodKey, range: { from: string | null; to: string | null }): string {
  if (key === "all") return "Mostrando todo o histórico de leads da workspace.";
  if (key === "custom") {
    if (range.from && range.to) {
      return `Mostrando leads de ${fmtBr(range.from)} até ${fmtBr(range.to)}.`;
    }
    return "Selecione um intervalo de datas pra ver os leads.";
  }
  return `Mostrando: ${PERIOD_LABEL[key].toLowerCase()}.`;
}

function fmtBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
