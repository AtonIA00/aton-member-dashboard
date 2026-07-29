import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getMetaInsightsForCore, isMetaAdsEnabled } from "@/lib/meta-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Insights de mídia (Meta Ads) pro Aton Core — SOMENTE LEITURA.
//
// Existe porque o META_SYSTEM_USER_TOKEN vive só neste serviço: o Core precisa
// de verba/CPL/CTR pro motor de saúde do assinante, mas não deve receber o
// token da Meta. Nível de anúncio + total do período, nada de campaign/adset
// nem breakdowns.
//
// Chamador: container do Core na overlay AtonbotNet, via
//   GET http://member-dashboard_app:3000/api/internal/meta-insights?workspace_id=..&days=7
//   Authorization: Bearer <INTERNAL_SHARED_SECRET>
// Mesmo segredo que o dash já usa pra CHAMAR o Core (openai-key /
// retorno-comercial) — canal simétrico, nenhum segredo novo. Sem cookie/sessão:
// o chamador é serviço, não navegador.
//
// A chave é o uchat_workspace_id (o Core raciocina por assinante); o mapa
// workspace → act_id vive em wa_meta_ads_accounts.
//
// Contrato de erro (nunca payload zerado — zero silencioso faria o relatório
// afirmar "nenhum investimento no período", pior que não ter o dado):
//   401 unauthorized        bearer ausente/errado
//   400 invalid_*           parâmetro fora do contrato
//   404 account_not_mapped  sem act_id cadastrado ou conta desabilitada
//   502 upstream_failed     Meta falhou e não há cache pra servir
//   503 meta_ads_disabled   kill-switch global desligado
//   503 not_configured      META_SYSTEM_USER_TOKEN ausente no serviço

const MIN_DAYS = 1;
const MAX_DAYS = 90;

function bearerOk(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7).trim(), "utf8");
  const expected = Buffer.from(secret, "utf8");
  // timingSafeEqual exige mesmo tamanho — compara o length antes (o tamanho
  // do segredo não é material sensível).
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function GET(req: NextRequest) {
  const secret = process.env.INTERNAL_SHARED_SECRET;
  if (!secret) {
    console.error("[api/internal/meta-insights] INTERNAL_SHARED_SECRET ausente");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isMetaAdsEnabled()) {
    return NextResponse.json({ error: "meta_ads_disabled" }, { status: 503 });
  }

  const q = req.nextUrl.searchParams;
  const workspaceId = (q.get("workspace_id") ?? "").trim();
  if (!/^\d{3,20}$/.test(workspaceId)) {
    return NextResponse.json({ error: "invalid_workspace_id" }, { status: 400 });
  }

  const daysRaw = q.get("days");
  const days = daysRaw === null ? 7 : Number(daysRaw);
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    return NextResponse.json(
      { error: "invalid_days", detail: `inteiro entre ${MIN_DAYS} e ${MAX_DAYS}` },
      { status: 400 },
    );
  }

  const result = await getMetaInsightsForCore(workspaceId, days);

  if (!result.ok) {
    if (result.reason === "not_mapped") {
      return NextResponse.json(
        { error: "account_not_mapped", detail: `workspace ${workspaceId} sem conta Meta ativa` },
        { status: 404 },
      );
    }
    if (result.reason === "no_token") {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    // Meta fora e sem cache: erro explícito, JAMAIS zeros.
    return NextResponse.json(
      { error: "upstream_failed", detail: "Meta Insights indisponível e sem cache" },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data, {
    // Resposta é por assinante e tem dado de mídia — não cachear em borda.
    headers: { "Cache-Control": "no-store" },
  });
}
