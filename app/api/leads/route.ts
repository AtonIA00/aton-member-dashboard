import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { checkDashboardAccess } from "@/lib/access";
import { getDashboardData } from "@/lib/leads";
import { parsePeriodKey, resolvePeriod } from "@/lib/period";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Endpoint server-side com agregação completa do dashboard. Mesmo gate de
// segurança da página principal: HMAC do iframe Uchat (anti-replay 5min) +
// tier habilitado em wa_member_dashboard_access.
//
// O Server Component da página / hoje chama getDashboardData() direto sem
// passar por esta rota — mas o endpoint existe pra refresh client-side
// futuro (M5/M6) e pra debug/testes via curl.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params = {
    workspace_id: url.searchParams.get("workspace_id") ?? undefined,
    user_id: url.searchParams.get("user_id") ?? undefined,
    timestamp: url.searchParams.get("timestamp") ?? undefined,
    signature: url.searchParams.get("signature") ?? undefined,
  };

  const hmac = validateUchatSignature(params, { maxAgeSeconds: 300 });
  if (!hmac.ok) {
    console.warn("[api/leads] hmac failed", { reason: hmac.reason });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = await checkDashboardAccess(hmac.workspaceId);
  if (!access.granted) {
    return NextResponse.json({ error: "no_access" }, { status: 403 });
  }

  const periodKey = parsePeriodKey(url.searchParams.get("period"));
  const customFrom = url.searchParams.get("from") ?? undefined;
  const customTo = url.searchParams.get("to") ?? undefined;
  const range = resolvePeriod(periodKey, customFrom, customTo);

  try {
    const data = await getDashboardData(hmac.workspaceId, range);
    return NextResponse.json(
      {
        workspace_id: data.workspaceId,
        period: { key: periodKey, range },
        kpis: data.kpis,
        funnel: data.funnel,
        ads_performance: data.adsPerformance,
        leads: data.leads,
        meta: {
          fetched_at: data.fetchedAt,
          fetch_ms: data.fetchMs,
          tier: access.tier,
        },
      },
      {
        headers: {
          // O cache é em memória no server — esse Cache-Control só evita
          // que CDN/proxy faça caching agressivo errado pelo workspace.
          "Cache-Control": "private, max-age=60, must-revalidate",
        },
      },
    );
  } catch (e) {
    console.error("[api/leads] error", {
      workspaceId: hmac.workspaceId,
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
