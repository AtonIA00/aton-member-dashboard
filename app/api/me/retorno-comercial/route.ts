import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Preferência de visibilidade da seção "Retorno do time comercial", POR
// WORKSPACE (wa_member_dashboard_access.mostrar_retorno_comercial). Controlada
// pelo botão ocultar/mostrar da UI. Persiste pro time inteiro do assinante,
// cross-device. Só UPDATE (nunca cria linha) — não vaza acesso ao dashboard.
//
// Janela HMAC de 12h (igual /api/me/theme — iframe fica aberto horas).
const MAX_AGE_SECONDS = 12 * 60 * 60;

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.visible !== "boolean") {
    return NextResponse.json({ error: "invalid_visible" }, { status: 400 });
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
  if (!hmac.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("wa_member_dashboard_access")
    .update({ mostrar_retorno_comercial: body.visible, updated_at: new Date().toISOString() })
    .eq("uchat_workspace_id", hmac.workspaceId);

  if (error) {
    console.error("[api/me/retorno-comercial] update falhou", { error: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, visible: body.visible });
}
