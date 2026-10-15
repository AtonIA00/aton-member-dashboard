import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { checkDashboardAccess } from "@/lib/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTrisulWorkspace } from "@/lib/trisul";
import { DIRECIONADO_PARA_MAX } from "@/lib/trisul-direcionamento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Marca/desfaz o direcionamento de um parceiro da Trisul para o coordenador.
// ÚNICA escrita do painel da Trisul: só as colunas direcionado_em,
// direcionado_para e direcionado_por de trisul_atendimentos.
// Autorização = a mesma da página: HMAC da UChat válido (janela 12h), workspace
// é a da Trisul (flag + id) e o acesso ao dashboard está liberado.
const MAX_AGE_SECONDS = 12 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POR_MAX = 120;

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hmac = validateUchatSignature(
    {
      workspace_id: str(body.workspace_id),
      user_id: str(body.user_id),
      timestamp: str(body.timestamp),
      signature: str(body.signature),
    },
    { maxAgeSeconds: MAX_AGE_SECONDS },
  );
  if (!hmac.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isTrisulWorkspace(hmac.workspaceId)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }
  const access = await checkDashboardAccess(hmac.workspaceId, hmac.userId);
  if (!access.granted) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  const id = str(body.id);
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  if (typeof body.direcionado !== "boolean") {
    return NextResponse.json({ error: "invalid_direcionado" }, { status: 400 });
  }
  const direcionado = body.direcionado;

  // Quem marcou: nome do visitante que a UChat passa na URL (user_name); sem
  // ele, o id do usuário UChat (assinado); em último caso, "painel".
  const userName = str(body.user_name)?.trim().slice(0, POR_MAX);
  const por = userName || (hmac.userId ? `Usuário ${hmac.userId}` : "painel");

  const para = str(body.para)?.trim().slice(0, DIRECIONADO_PARA_MAX) || null;

  const patch = direcionado
    ? { direcionado_em: new Date().toISOString(), direcionado_para: para, direcionado_por: por }
    : { direcionado_em: null, direcionado_para: null, direcionado_por: null };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("trisul_atendimentos")
    .update(patch)
    .eq("id", id)
    .select("id, direcionado_em, direcionado_para, direcionado_por");

  if (error) {
    console.error("[api/trisul/direcionar] falhou", { id, error: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Auditoria: quem mudou o quê.
  console.warn("[api/trisul/direcionar] OK", {
    by: hmac.userId,
    workspace: hmac.workspaceId,
    id,
    direcionado,
  });

  return NextResponse.json({ ok: true, row: data[0] });
}
