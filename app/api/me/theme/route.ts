import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Preferência de tema (light/dark) por usuário Uchat.
//
// Identidade vem do HMAC do iframe — mesmo pacote (workspace_id, user_id,
// timestamp, signature) que o page.tsx valida no SSR. Como o iframe pode
// ficar aberto por horas e o toggle precisa funcionar a qualquer momento,
// usamos janela maior (12h) que o padrão de 300s dos endpoints do TON —
// o risco de "freshness leak" pra um endpoint que só muda tema é baixo;
// a assinatura HMAC continua sendo a barreira real de identidade.
const MAX_AGE_SECONDS = 12 * 60 * 60;

type ThemeValue = "light" | "dark";

function isThemeValue(v: unknown): v is ThemeValue {
  return v === "light" || v === "dark";
}

async function authFromQuery(req: NextRequest) {
  const url = new URL(req.url);
  const params = {
    workspace_id: url.searchParams.get("workspace_id") ?? undefined,
    user_id: url.searchParams.get("user_id") ?? undefined,
    timestamp: url.searchParams.get("timestamp") ?? undefined,
    signature: url.searchParams.get("signature") ?? undefined,
  };
  return validateUchatSignature(params, { maxAgeSeconds: MAX_AGE_SECONDS });
}

async function authFromBody(body: Record<string, unknown>) {
  const params = {
    workspace_id: typeof body.workspace_id === "string" ? body.workspace_id : undefined,
    user_id: typeof body.user_id === "string" ? body.user_id : undefined,
    timestamp: typeof body.timestamp === "string" ? body.timestamp : undefined,
    signature: typeof body.signature === "string" ? body.signature : undefined,
  };
  return validateUchatSignature(params, { maxAgeSeconds: MAX_AGE_SECONDS });
}

// GET — devolve preferência atual (ou "light" default se não houver linha).
export async function GET(req: NextRequest) {
  const auth = await authFromQuery(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_user_preferences")
    .select("theme")
    .eq("uchat_workspace_id", auth.workspaceId)
    .eq("uchat_user_id", auth.userId)
    .maybeSingle();

  if (error) {
    console.error("[api/me/theme][GET] supabase error", { error: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const theme: ThemeValue = isThemeValue(data?.theme) ? data!.theme : "light";
  return NextResponse.json({ theme });
}

// PATCH — upsert da preferência. Body: { theme, workspace_id, user_id, timestamp, signature }.
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const theme = body.theme;
  if (!isThemeValue(theme)) {
    return NextResponse.json({ error: "invalid_theme" }, { status: 400 });
  }

  const auth = await authFromBody(body);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("wa_user_preferences")
    .upsert(
      {
        uchat_workspace_id: auth.workspaceId,
        uchat_user_id: auth.userId,
        theme,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "uchat_workspace_id,uchat_user_id" },
    );

  if (error) {
    console.error("[api/me/theme][PATCH] supabase error", { error: error.message });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, theme });
}
