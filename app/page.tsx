import { checkDashboardAccess } from "@/lib/access";
import { validateUchatSignature } from "@/lib/hmac";
import { parsePeriodKey } from "@/lib/period";
import { parseFilters } from "@/lib/filters";
import { InvalidAccess } from "@/components/InvalidAccess";
import { UpsellScreen } from "@/components/UpsellScreen";
import { Dashboard } from "@/components/dashboard/Dashboard";

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

  const hmac = validateUchatSignature(params, { maxAgeSeconds: 300 });
  if (!hmac.ok) {
    console.warn("[page] hmac failed", { reason: hmac.reason });
    return <InvalidAccess />;
  }

  const workspaceName = firstString(sp.workspace_name) ?? "";
  const userName = firstString(sp.user_name) ?? "";

  const access = await checkDashboardAccess(hmac.workspaceId);
  if (!access.granted) {
    return <UpsellScreen workspaceName={workspaceName || undefined} />;
  }

  const periodKey = parsePeriodKey(firstString(sp.period));
  const customFrom = firstString(sp.from);
  const customTo = firstString(sp.to);
  const filters = parseFilters(sp);

  return (
    <Dashboard
      workspaceId={hmac.workspaceId}
      workspaceName={workspaceName || `Workspace ${hmac.workspaceId}`}
      userName={userName}
      tier={access.tier}
      daysUntilExpiry={access.daysUntilExpiry}
      periodKey={periodKey}
      customFrom={customFrom}
      customTo={customTo}
      filters={filters}
    />
  );
}
