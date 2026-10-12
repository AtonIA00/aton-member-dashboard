import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isMetaAdsEnabled } from "@/lib/meta-ads";
import { lerGraph } from "@/lib/meta-leitura";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Leitura da Graph API para o Code da CS (MCP meta-ads), SOMENTE LEITURA.
// Regras e travas em lib/meta-leitura.ts.
//
// Chamador: container do Core (acao meta_ler de /api/cs-manutencao), via
//   POST http://member-dashboard_app:3000/api/internal/meta-graph
//   Authorization: Bearer <INTERNAL_SHARED_SECRET>
//   { "caminho": "act_123/insights", "params": { "fields": "spend", ... } }
// POST só pelo corpo JSON (params podem ser objetos); na Meta é sempre GET.
//
// Respostas:
//   200 { data }                          resposta da Meta, sem paging.next/previous
//   422 { error: "meta_error", meta_error }  a Meta recusou (código e mensagem dela)
//   400/403 { error }                     fora do contrato / conta não ligada
//   401, 503 como no meta-insights

function bearerOk(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7).trim(), "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_SHARED_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isMetaAdsEnabled()) return NextResponse.json({ error: "meta_ads_disabled" }, { status: 503 });

  let body: { caminho?: unknown; params?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const r = await lerGraph(body.caminho, body.params);
  if (r.ok) return NextResponse.json({ data: r.data });
  return NextResponse.json(
    { error: r.erro, ...(r.meta_error ? { meta_error: r.meta_error } : {}) },
    { status: r.status },
  );
}
