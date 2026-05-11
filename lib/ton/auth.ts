import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { checkDashboardAccess } from "@/lib/access";

// Gate de acesso ao TON (compartilhado pelos endpoints /api/ton/*):
// 1. HMAC válido do iframe Uchat
// 2. tier === 'enterprise' OU (tier === 'pro' AND MEMBER_DASHBOARD_TON_PRO_ENABLED=true)
//
// Os params HMAC (workspace_id, user_id, timestamp, signature) podem vir via
// query string (GET) ou body JSON (POST). Helper aceita ambos.

export type TonAuthOk = {
  ok: true;
  workspaceId: string;
  userId: string;
};
export type TonAuthFail = {
  ok: false;
  status: number;
  message: string;
};
export type TonAuthResult = TonAuthOk | TonAuthFail;

export function isTonEnabledForTier(tier: "trial" | "pro" | "enterprise"): boolean {
  if (tier === "enterprise") return true;
  if (tier === "pro" && process.env.MEMBER_DASHBOARD_TON_PRO_ENABLED === "true") return true;
  return false;
}

export async function authenticateTonRequest(
  req: NextRequest,
  bodyParams?: { workspace_id?: string; user_id?: string; timestamp?: string; signature?: string },
): Promise<TonAuthResult> {
  const url = new URL(req.url);
  const params = {
    workspace_id: bodyParams?.workspace_id ?? url.searchParams.get("workspace_id") ?? undefined,
    user_id: bodyParams?.user_id ?? url.searchParams.get("user_id") ?? undefined,
    timestamp: bodyParams?.timestamp ?? url.searchParams.get("timestamp") ?? undefined,
    signature: bodyParams?.signature ?? url.searchParams.get("signature") ?? undefined,
  };

  const hmac = validateUchatSignature(params, { maxAgeSeconds: 300 });
  if (!hmac.ok) {
    return { ok: false, status: 401, message: "unauthorized" };
  }

  const access = await checkDashboardAccess(hmac.workspaceId);
  if (!access.granted) {
    return { ok: false, status: 403, message: "no_access" };
  }
  if (!isTonEnabledForTier(access.tier)) {
    return { ok: false, status: 403, message: "ton_not_available_for_tier" };
  }

  return { ok: true, workspaceId: hmac.workspaceId, userId: hmac.userId };
}

export function tonAuthErrorResponse(result: TonAuthFail): NextResponse {
  return NextResponse.json({ error: result.message }, { status: result.status });
}
