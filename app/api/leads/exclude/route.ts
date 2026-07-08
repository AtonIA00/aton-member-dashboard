import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { checkDashboardAccess } from "@/lib/access";
import {
  addExclusion,
  isLeadExcludeAllowed,
  listExclusions,
  removeExclusion,
} from "@/lib/lead-exclusions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Marcar/restaurar leads de teste. Só user_ids Aton (allowlist por env).
// HMAC do iframe (janela 12h, igual /api/me/theme — iframe fica aberto horas).
const MAX_AGE_SECONDS = 12 * 60 * 60;

type Authed = { workspaceId: string; userId: string };

async function authorize(
  params: Parameters<typeof validateUchatSignature>[0],
): Promise<Authed | NextResponse> {
  const hmac = validateUchatSignature(params, { maxAgeSeconds: MAX_AGE_SECONDS });
  if (!hmac.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await checkDashboardAccess(hmac.workspaceId, hmac.userId);
  if (!access.granted) return NextResponse.json({ error: "no_access" }, { status: 403 });

  if (!isLeadExcludeAllowed(hmac.userId)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }
  return { workspaceId: hmac.workspaceId, userId: hmac.userId };
}

// GET — lista dos leads ocultos (painel "gerenciar").
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const auth = await authorize({
    workspace_id: url.searchParams.get("workspace_id") ?? undefined,
    user_id: url.searchParams.get("user_id") ?? undefined,
    timestamp: url.searchParams.get("timestamp") ?? undefined,
    signature: url.searchParams.get("signature") ?? undefined,
  });
  if (auth instanceof NextResponse) return auth;

  const exclusions = await listExclusions(auth.workspaceId);
  return NextResponse.json({ exclusions });
}

// POST — { action: 'exclude'|'restore', lead_id, reason?, nome?, telefone?, + HMAC }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const auth = await authorize({
    workspace_id: typeof body.workspace_id === "string" ? body.workspace_id : undefined,
    user_id: typeof body.user_id === "string" ? body.user_id : undefined,
    timestamp: typeof body.timestamp === "string" ? body.timestamp : undefined,
    signature: typeof body.signature === "string" ? body.signature : undefined,
  });
  if (auth instanceof NextResponse) return auth;

  const leadId = Number(body.lead_id);
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return NextResponse.json({ error: "invalid_lead_id" }, { status: 400 });
  }
  const action = body.action;

  if (action === "exclude") {
    const ok = await addExclusion({
      workspaceId: auth.workspaceId,
      leadId,
      userId: auth.userId,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      nome: typeof body.nome === "string" ? body.nome : null,
      telefone: typeof body.telefone === "string" ? body.telefone : null,
    });
    return ok
      ? NextResponse.json({ ok: true, action: "exclude", lead_id: leadId })
      : NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  if (action === "restore") {
    const ok = await removeExclusion(auth.workspaceId, leadId);
    return ok
      ? NextResponse.json({ ok: true, action: "restore", lead_id: leadId })
      : NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
