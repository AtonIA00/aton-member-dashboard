import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { checkDashboardAccess } from "@/lib/access";
import { getRetornoComercial, isRetornoComercialEnabled } from "@/lib/retorno-comercial/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retorno do time comercial — proxy server-to-server pro Aton Core.
//
// A seção é client-facing e independente dos filtros do dash (v1 usa janela
// própria do Core). O client (RetornoComercialSection) chama esta rota; ela
// valida o HMAC do iframe, checa acesso + toggle + feature flag e delega ao
// adapter, que fala com o Core. Qualquer indisponibilidade → 204 (a UI
// esconde a seção; nunca "0%").
//
// Janela de 12h no HMAC (igual /api/me/theme): iframe fica aberto horas; a
// assinatura HMAC segue sendo a barreira real.
const MAX_AGE_SECONDS = 12 * 60 * 60;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params = {
    workspace_id: url.searchParams.get("workspace_id") ?? undefined,
    user_id: url.searchParams.get("user_id") ?? undefined,
    timestamp: url.searchParams.get("timestamp") ?? undefined,
    signature: url.searchParams.get("signature") ?? undefined,
  };

  const hmac = validateUchatSignature(params, { maxAgeSeconds: MAX_AGE_SECONDS });
  if (!hmac.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = await checkDashboardAccess(hmac.workspaceId, hmac.userId);
  if (!access.granted || !isRetornoComercialEnabled(access)) {
    // Desligado (flag/toggle) ou sem acesso → seção some. 204 sem corpo.
    return new NextResponse(null, { status: 204 });
  }

  const data = await getRetornoComercial(hmac.workspaceId);
  if (!data) {
    // Core indisponível / não configurado → some (degradação graciosa).
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json(data);
}
