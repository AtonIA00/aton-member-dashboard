import { checkDashboardAccess } from "@/lib/access";
import { validateUchatSignature } from "@/lib/hmac";
import { parsePeriodKey } from "@/lib/period";
import { parseFilters } from "@/lib/filters";
import { InvalidAccess } from "@/components/InvalidAccess";
import { UpsellScreen } from "@/components/UpsellScreen";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { parseTab } from "@/lib/tabs";
import { isRetornoComercialEnabled } from "@/lib/retorno-comercial/source";
import { isLeadExcludeAllowed } from "@/lib/lead-exclusions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;

  const params = {
    workspace_id: firstString(sp.workspace_id),
    user_id: firstString(sp.user_id),
    timestamp: firstString(sp.timestamp),
    signature: firstString(sp.signature),
  };

  // Janela de 12h pra freshness do HMAC. A assinatura HMAC continua sendo a
  // barreira real contra forge — sem a UCHAT_PRIVATE_KEY ninguém produz
  // signature válida. O timestamp só protege contra REPLAY de URLs antigas;
  // 5min era curto demais pro uso real: usuário deixa o iframe Uchat aberto
  // por horas e cada clique de filtro/período re-renderiza server-side e
  // re-valida HMAC. Com 300s, qualquer navegação após 5min cai em
  // InvalidAccess. 12h cobre uma sessão de trabalho inteira e mantém a
  // proteção contra replay de longa data.
  const hmac = validateUchatSignature(params, { maxAgeSeconds: 12 * 60 * 60 });
  if (!hmac.ok) {
    console.warn("[page] hmac failed", { reason: hmac.reason });
    return <InvalidAccess />;
  }

  const workspaceName = firstString(sp.workspace_name) ?? "";

  const access = await checkDashboardAccess(hmac.workspaceId, hmac.userId);
  if (!access.granted) {
    return <UpsellScreen workspaceName={workspaceName || undefined} />;
  }

  const periodKey = parsePeriodKey(firstString(sp.period));
  const customFrom = firstString(sp.from);
  const customTo = firstString(sp.to);
  const filters = parseFilters(sp);
  const tab = parseTab(firstString(sp.tab));

  // Params HMAC repassados pro Client Component do TonChat — ele usa pra
  // autenticar /api/ton/chat e /api/ton/threads. Signature original já foi
  // validada server-side; o client só replica nos requests subsequentes.
  const hmacForClient = {
    workspace_id: params.workspace_id!,
    user_id: params.user_id!,
    timestamp: params.timestamp!,
    signature: params.signature!,
    user_name: firstString(sp.user_name),
    workspace_name: workspaceName || undefined,
  };

  return (
    <Dashboard
      workspaceId={hmac.workspaceId}
      workspaceName={workspaceName || `Workspace ${hmac.workspaceId}`}
      tier={access.tier}
      daysUntilExpiry={access.daysUntilExpiry}
      hoursUntilExpiry={access.hoursUntilExpiry}
      habilitadoAt={access.habilitadoAt}
      expiresAt={access.expiresAt}
      periodKey={periodKey}
      customFrom={customFrom}
      customTo={customTo}
      filters={filters}
      tab={tab}
      hmac={hmacForClient}
      retornoComercialEnabled={isRetornoComercialEnabled(access)}
      canExcludeLeads={isLeadExcludeAllowed(hmac.userId)}
      adminView={access.superadminBypass}
    />
  );
}
