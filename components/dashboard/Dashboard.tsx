import { getDashboardData } from "@/lib/leads";
import { PERIOD_LABEL, parsePeriodKey, resolvePeriod, type PeriodKey } from "@/lib/period";
import { hasAnyFilter, type Filters } from "@/lib/filters";
import type { Tier } from "@/lib/access";
import { isTonEnabledForTier } from "@/lib/ton/auth";
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
import { MonthlyEvolutionChart } from "./charts/MonthlyEvolutionChart";
import { TabSwitcher } from "./TabSwitcher";
import type { TabKey } from "@/lib/tabs";
import { TonView } from "@/components/ton/TonView";
import { AtonLogo } from "@/components/brand/AtonLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { RetornoComercialSection } from "./RetornoComercialSection";
import { getMetaAdsForWorkspace, toTablePayload, type MetaAdsForTable } from "@/lib/meta-ads";

type HmacParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
  user_name?: string;
  workspace_name?: string;
};

type Props = {
  workspaceId: string;
  workspaceName: string;
  tier: Tier;
  daysUntilExpiry: number | null;
  hoursUntilExpiry: number | null;
  habilitadoAt: Date | null;
  expiresAt: Date | null;
  periodKey: PeriodKey;
  customFrom?: string;
  customTo?: string;
  filters: Filters;
  /** Aba ativa (M9). 'dashboard' default. */
  tab: TabKey;
  /** Params HMAC do iframe original — repassados pro TonView (chat usa). */
  hmac: HmacParams;
  /** Feature "Retorno do time comercial" disponível (flag global). */
  retornoComercialEnabled: boolean;
  /** Estado inicial de visibilidade da seção (toggle ocultar/mostrar). */
  retornoComercialVisible: boolean;
  /** Se o viewer pode marcar leads como teste (allowlist Aton). */
  canExcludeLeads: boolean;
  /** Se o viewer pode editar status/MQL direto no dash (SÓ super-admin). */
  canEditLeads: boolean;
  /** true = acesso via bypass de super-admin (workspace não liberado). */
  adminView: boolean;
};

export async function Dashboard({
  workspaceId,
  workspaceName,
  tier,
  daysUntilExpiry,
  hoursUntilExpiry,
  habilitadoAt,
  expiresAt,
  periodKey,
  customFrom,
  customTo,
  filters,
  tab,
  hmac,
  retornoComercialEnabled,
  retornoComercialVisible,
  canExcludeLeads,
  canEditLeads,
  adminView,
}: Props) {
  const tonAvailable = isTonEnabledForTier(tier);
  const isTonTab = tab === "ton" && tonAvailable
    // Se tab=ton mas tier não tem TON, mostra a tela de upsell (TonView decide)
    || tab === "ton";

  // Fetch só quando estamos no tab Dashboard. Aba TON não precisa do
  // agregado pesado — economiza um fetch a cada navegação.
  //
  // .catch logga contexto (workspace/period/from/to) + stack pro runner e
  // re-lança com ctx agregado na message. Assim error.tsx mostra a chave
  // do bug pro suporte e os logs do container ficam acionáveis.
  const dashboardDataPromise = isTonTab
    ? null
    : getDashboardData(
        workspaceId,
        resolvePeriod(periodKey, customFrom, customTo),
        filters,
        periodKey,
      ).catch((err) => {
        const ctx = `workspace=${workspaceId} period=${periodKey} from=${customFrom ?? "-"} to=${customTo ?? "-"}`;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[dashboard][SSR] getDashboardData failed", {
          ctx,
          msg,
          stack: err instanceof Error ? err.stack : undefined,
        });
        const wrapped = new Error(`[${ctx}] ${msg}`);
        if (err instanceof Error && err.stack) wrapped.stack = err.stack;
        throw wrapped;
      });

  // Meta Ads (custo × desfecho) — encadeado no agregado de leads porque o
  // fetch é FILTRADO pelos id_anuncio que têm leads na base (3 chamadas
  // pequenas em paralelo em vez de varrer a conta inteira — a Brows tem 487
  // ads históricos e a varredura levava 17-33s). null quando flag off /
  // sem conta vinculada / erro / deadline (degrada silencioso: o dash
  // renderiza sem a camada de custo).
  const metaAdsPromise = isTonTab
    ? Promise.resolve(null)
    : dashboardDataPromise! // non-null: só é null quando isTonTab
        .then((d) =>
          getMetaAdsForWorkspace(
            workspaceId,
            resolvePeriod(periodKey, customFrom, customTo),
            [...new Set(d.adsPerformance.filter((r) => !r.isUnknownId).map((r) => r.idAnuncio))],
          ),
        )
        .then((d) => (d ? toTablePayload(d) : null))
        .catch((e) => {
          console.error("[dashboard] meta-ads falhou (seguindo sem custo)", {
            workspaceId,
            error: e instanceof Error ? e.message : String(e),
          });
          return null;
        });

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          // Halo sutil em aton-blue. Mantém o brilho de identidade em ambos
          // os temas (em light vira um leve azulado no topo; em dark
          // continua etéreo).
          background:
            "radial-gradient(50% 40% at 30% 0%, rgba(0, 87, 255, 0.12) 0%, rgba(0, 87, 255, 0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-8 py-8 lg:px-12 lg:py-10">
        {/* Header */}
        <header className="flex flex-col gap-5 border-b border-[color:var(--border)] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            {/* Wordmark + sub-label "Member Dashboard". Substitui o textual
                "Aton · Member Dashboard" anterior. */}
            <div className="flex items-center gap-2.5">
              <AtonLogo height={18} />
              <span className="text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted-foreground)]">
                · Member Dashboard
              </span>
            </div>
            <h1 className="mt-2 truncate font-[family-name:var(--font-montserrat)] text-3xl font-bold leading-tight text-[color:var(--foreground)] sm:text-4xl">
              {workspaceName}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Indicador de bypass: workspace não liberado, visível só via
                super-admin. Deixa claro que não é uma visão de assinante real. */}
            {adminView && (
              <span
                title="Acesso via super-admin (workspace não liberado)"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-[#f59e0b]"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                Admin
              </span>
            )}
            {/* PeriodPicker só faz sentido na aba Dashboard */}
            {!isTonTab && <PeriodPicker />}
            <TierBadge
              tier={tier}
              daysUntilExpiry={daysUntilExpiry}
              hoursUntilExpiry={hoursUntilExpiry}
              habilitadoAt={habilitadoAt}
              expiresAt={expiresAt}
            />
            {/* Toggle light/dark isolado (produto não tem login/avatar) */}
            <ThemeToggle hmac={hmac} />
          </div>
        </header>

        {/* Tab switcher — só renderiza se workspace tem acesso ao TON */}
        <TabSwitcher active={tab} tonAvailable={tonAvailable} />

        {/* Conteúdo conforme a aba ativa */}
        {isTonTab ? (
          <TonView tier={tier} hmac={hmac} />
        ) : (
          dashboardDataPromise && (
            <DashboardContent
              data={await dashboardDataPromise}
              metaAds={await metaAdsPromise}
              workspaceName={workspaceName}
              periodKey={periodKey}
              customFrom={customFrom}
              customTo={customTo}
              hmac={hmac}
              retornoComercialEnabled={retornoComercialEnabled}
              retornoComercialVisible={retornoComercialVisible}
              canExcludeLeads={canExcludeLeads}
              canEditLeads={canEditLeads}
            />
          )
        )}

        <div className="mt-auto pt-10 text-center text-[11px] text-[color:var(--muted-foreground)]">
          <span className="font-mono">member-dashboard.aton-ia.com.br</span>
          <span className="mx-2 opacity-50">·</span>
          <span>Aton IA</span>
        </div>
      </div>
    </main>
  );
}

type DashboardContentProps = {
  data: Awaited<ReturnType<typeof getDashboardData>>;
  metaAds: MetaAdsForTable | null;
  workspaceName: string;
  periodKey: PeriodKey;
  customFrom?: string;
  customTo?: string;
  hmac: HmacParams;
  retornoComercialEnabled: boolean;
  retornoComercialVisible: boolean;
  canExcludeLeads: boolean;
  canEditLeads: boolean;
};

function DashboardContent({
  data,
  metaAds,
  workspaceName,
  periodKey,
  customFrom,
  customTo,
  hmac,
  retornoComercialEnabled,
  retornoComercialVisible,
  canExcludeLeads,
  canEditLeads,
}: DashboardContentProps) {
  const range = resolvePeriod(periodKey, customFrom, customTo);
  const periodSummary = formatPeriodSummary(periodKey, range);
  const filtersActive = hasAnyFilter(data.filters);

  // Rótulo conciso do período pro arquivo exportado (título/nome).
  const periodLabel =
    periodKey === "custom" && range.from && range.to
      ? `${fmtBr(range.from)} a ${fmtBr(range.to)}`
      : PERIOD_LABEL[periodKey];

  return (
    <>
      <p className="mt-4 text-sm text-[color:var(--muted-foreground)]">{periodSummary}</p>

      {/* FilterBar — só aparece se tem leads no período */}
      <FilterBar dimensions={data.dimensions} totalNoPeriodo={data.totalNoPeriodo} />

      {/* KPIs */}
      <div className="mt-6">
        <KpiRow
          kpis={data.kpis}
          kpisPrevious={data.kpisPrevious}
          deltas={data.deltas}
        />
      </div>

      {/* Retorno do time comercial — janela própria (não segue os filtros do
          dash), some sozinha se indisponível/desligada. Fica fora do ternário
          de período vazio de propósito: é um snapshot "de agora". */}
      <RetornoComercialSection
        enabled={retornoComercialEnabled}
        initialVisible={retornoComercialVisible}
        hmac={hmac}
      />

      {data.totalNoPeriodo === 0 ? (
        <EmptyState
          title="Você ainda não recebeu leads nesse período"
          body="Tente um intervalo maior no dropdown acima. Se acredita que deveria ter leads aqui, fale com a Aton."
        />
      ) : data.kpis.total === 0 && filtersActive ? (
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
            <AdsPerformanceTable
              rows={data.adsPerformance}
              metaAds={metaAds}
              kpis={data.kpis}
              filtersActive={filtersActive}
              hmac={hmac}
            />
          </div>

          <section aria-label="Análise visual" className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <span aria-hidden className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]" />
              <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
                Análise visual
              </h2>
            </div>
            <div>
              <MonthlyEvolutionChart data={data.charts.monthlyEvolution} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <DailyVolumeChart data={data.charts.dailyVolume} />
              </div>
              <div>
                <MqlDonutChart data={data.charts.mqlDonut} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CampaignVolumeChart data={data.charts.campaignVolume} />
              <StageDistributionChart data={data.charts.stageDistribution} />
            </div>
          </section>

          <div className="mt-8">
            <LeadsTable
              leads={data.leads}
              workspaceName={workspaceName}
              periodLabel={periodLabel}
              filtersActive={filtersActive}
              canExclude={canExcludeLeads}
              canEdit={canEditLeads}
              hmac={hmac}
            />
          </div>
        </>
      )}
    </>
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
