import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Quota diária por workspace — soft warning visual no chat.
// Reset diário em America/Sao_Paulo (faz sentido pro usuário).
//
// Níveis (configurados na spec M9):
// - < 50k:    none      — sem indicador
// - 50k-100k: visible   — contador no rodapé
// - 100k-500k: warn     — banner amber no topo
// - >= 500k:  blocked   — modal "limite atingido"

export type QuotaLevel = "none" | "visible" | "warn" | "blocked";

export type QuotaState = {
  tokensToday: number;
  level: QuotaLevel;
  resetsAtIso: string;
  limit: number;
};

const VISIBLE_THRESHOLD = 50_000;
const WARN_THRESHOLD = 100_000;
const BLOCKED_THRESHOLD = 500_000;

/**
 * Retorna o intervalo [startUTC, endUTC) que cobre HOJE em America/Sao_Paulo.
 * São Paulo = UTC-3 sem DST (desde 2019).
 */
function spDayBounds(): { startUtc: string; endUtc: string; resetsAtIso: string } {
  // Hora atual em SP: now - 3h
  const now = new Date();
  const spNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  // Meia-noite SP em UTC = SP-00:00 + 3h
  const spMidnight = new Date(
    Date.UTC(spNow.getUTCFullYear(), spNow.getUTCMonth(), spNow.getUTCDate(), 0, 0, 0),
  );
  const startUtc = new Date(spMidnight.getTime() + 3 * 60 * 60 * 1000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
    resetsAtIso: endUtc.toISOString(),
  };
}

export async function getQuotaState(workspaceId: string): Promise<QuotaState> {
  const { startUtc, endUtc, resetsAtIso } = spDayBounds();
  const supabase = getSupabaseAdmin();

  // Soma tokens das mensagens DO DIA que pertencem a threads desse workspace.
  // 2 queries: lista threads do workspace, soma tokens nas mensagens delas.
  const { data: threads } = await supabase
    .from("wa_chat_threads")
    .select("id")
    .eq("uchat_workspace_id", workspaceId);

  const ids = (threads ?? []).map((t) => (t as { id: string }).id);
  if (ids.length === 0) {
    return { tokensToday: 0, level: "none", resetsAtIso, limit: BLOCKED_THRESHOLD };
  }

  const { data: msgs } = await supabase
    .from("wa_chat_messages")
    .select("tokens_in, tokens_out")
    .in("thread_id", ids)
    .gte("created_at", startUtc)
    .lt("created_at", endUtc);

  let total = 0;
  for (const m of msgs ?? []) {
    const r = m as { tokens_in: number | null; tokens_out: number | null };
    total += (r.tokens_in ?? 0) + (r.tokens_out ?? 0);
  }

  let level: QuotaLevel = "none";
  if (total >= BLOCKED_THRESHOLD) level = "blocked";
  else if (total >= WARN_THRESHOLD) level = "warn";
  else if (total >= VISIBLE_THRESHOLD) level = "visible";

  return { tokensToday: total, level, resetsAtIso, limit: BLOCKED_THRESHOLD };
}
