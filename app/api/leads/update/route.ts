import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { isSuperAdmin } from "@/lib/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { invalidateLeadsCache } from "@/lib/leads";
import { STATUS_OPTIONS } from "@/lib/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Edição direta de status (etapa_funil) e MQL de um lead — SÓ super-admin Aton.
// ⚠️ ESCREVE no terrace360_leads_atonhub (base compartilhada, alimentada por
// outro pipeline). Gate real = isSuperAdmin (server-side). Escopo por workspace
// (id_workspace_responsavel) como defesa extra. Janela HMAC 12h.
const MAX_AGE_SECONDS = 12 * 60 * 60;

const STATUS_VALUES = new Set(STATUS_OPTIONS.map((o) => o.value));
const MQL_VALUES = new Set(["sim", "não", null]);

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hmac = validateUchatSignature(
    {
      workspace_id: typeof body.workspace_id === "string" ? body.workspace_id : undefined,
      user_id: typeof body.user_id === "string" ? body.user_id : undefined,
      timestamp: typeof body.timestamp === "string" ? body.timestamp : undefined,
      signature: typeof body.signature === "string" ? body.signature : undefined,
    },
    { maxAgeSeconds: MAX_AGE_SECONDS },
  );
  if (!hmac.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Barreira REAL: só super-admin escreve.
  if (!isSuperAdmin(hmac.userId)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  const leadId = Number(body.lead_id);
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return NextResponse.json({ error: "invalid_lead_id" }, { status: 400 });
  }

  const field = body.field;
  let column: "etapa_funil" | "mql";
  let value: string | null;

  if (field === "status") {
    column = "etapa_funil";
    if (typeof body.value !== "string" || !STATUS_VALUES.has(body.value)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    value = body.value;
  } else if (field === "mql") {
    column = "mql";
    const v = body.value === null || body.value === "" ? null : body.value;
    if (!MQL_VALUES.has(v as string | null)) {
      return NextResponse.json({ error: "invalid_mql" }, { status: 400 });
    }
    value = v as string | null;
  } else {
    return NextResponse.json({ error: "invalid_field" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Escopo por workspace: super-admin não altera lead de outra workspace por engano.
  const { data, error } = await supabase
    .from("terrace360_leads_atonhub")
    .update({ [column]: value })
    .eq("id", leadId)
    .eq("id_workspace_responsavel", hmac.workspaceId)
    .select("id");

  if (error) {
    console.error("[api/leads/update] falhou", { leadId, column, error: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    // lead não existe nessa workspace (id errado ou cross-workspace).
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // Auditoria: quem mudou o quê.
  console.warn("[api/leads/update] OK", {
    by: hmac.userId,
    workspace: hmac.workspaceId,
    leadId,
    column,
    value,
  });

  // Próximo fetch reflete a mudança (não a versão cacheada de 60s).
  invalidateLeadsCache(hmac.workspaceId);

  return NextResponse.json({ ok: true, lead_id: leadId, field, value });
}
