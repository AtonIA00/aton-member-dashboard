import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Preferência "Detalhes" por usuário Uchat: exibe ou esconde as notas de
// apoio do dash (rodapés, avisos de qualidade do dado, definições, variação
// contra o período anterior).
//
// Existe porque a regra de design é tela limpa ("nunca coloque explicações
// dentro de um dash"), mas parte dessas notas é o que impede um número de ser
// lido errado, e o Murillo usa elas em apresentação com cliente. Desligado por
// padrão: o assinante vê a tela limpa; quem liga, continua ligado.
//
// Mesma autenticação e mesma janela de 12h do /api/me/theme: o iframe fica
// aberto por horas e o toggle tem que funcionar a qualquer momento. A
// assinatura HMAC continua sendo a barreira de identidade.
const MAX_AGE_SECONDS = 12 * 60 * 60;

function params(src: Record<string, unknown>) {
  const s = (k: string) => (typeof src[k] === "string" ? (src[k] as string) : undefined);
  return {
    workspace_id: s("workspace_id"),
    user_id: s("user_id"),
    timestamp: s("timestamp"),
    signature: s("signature"),
  };
}

export async function GET(req: NextRequest) {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const auth = await validateUchatSignature(params(q), { maxAgeSeconds: MAX_AGE_SECONDS });
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("wa_user_preferences")
    .select("mostrar_detalhes")
    .eq("uchat_workspace_id", auth.workspaceId)
    .eq("uchat_user_id", auth.userId)
    .maybeSingle();

  if (error) {
    console.error("[api/me/detalhes][GET] supabase error", { error: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  return NextResponse.json({ mostrarDetalhes: data?.mostrar_detalhes === true });
}

// PATCH — body: { mostrarDetalhes, workspace_id, user_id, timestamp, signature }.
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.mostrarDetalhes !== "boolean") {
    return NextResponse.json({ error: "invalid_value" }, { status: 400 });
  }

  const auth = await validateUchatSignature(params(body), { maxAgeSeconds: MAX_AGE_SECONDS });
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  // Upsert só da coluna própria: o PostgREST mescla as colunas enviadas, então
  // o tema do usuário não é tocado. Linha nova nasce com theme='light' (default).
  const { error } = await getSupabaseAdmin()
    .from("wa_user_preferences")
    .upsert(
      {
        uchat_workspace_id: auth.workspaceId,
        uchat_user_id: auth.userId,
        mostrar_detalhes: body.mostrarDetalhes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "uchat_workspace_id,uchat_user_id" },
    );

  if (error) {
    console.error("[api/me/detalhes][PATCH] supabase error", { error: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, mostrarDetalhes: body.mostrarDetalhes });
}
