import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import { isSuperAdmin } from "./access";

// Exclusão "soft" de leads de teste (wa_lead_exclusions). O agregador filtra
// estes lead_id antes de calcular tudo — some das métricas/charts/tabela/
// export. Reversível, auditável, sem tocar no terrace360 compartilhado.
//
// Permissão: só user_ids da Aton (allowlist por env). Sobe DARK — enquanto
// MEMBER_DASHBOARD_LEAD_EXCLUDE_ALLOWLIST estiver vazio, ninguém vê o botão.

export type LeadExclusion = {
  lead_id: number;
  reason: string;
  nome_snapshot: string | null;
  telefone_snapshot: string | null;
  excluded_by: string | null;
  created_at: string;
};

/** user_ids Aton autorizados a marcar/restaurar (CSV no env). */
function allowlist(): Set<string> {
  const raw = process.env.MEMBER_DASHBOARD_LEAD_EXCLUDE_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isLeadExcludeAllowed(userId: string | null | undefined): boolean {
  if (!userId) return false;
  // Super-admin herda o poder de excluir (superset de "ver-tudo").
  if (isSuperAdmin(userId)) return true;
  const list = allowlist();
  return list.size > 0 && list.has(String(userId));
}

/**
 * Ids excluídos do workspace. SEM cache — a tabela é minúscula (poucos leads
 * de teste) e o marcar/restaurar precisa refletir na hora no router.refresh().
 * Falha silenciosa (retorna Set vazio) pra nunca derrubar o dashboard.
 */
export async function getExcludedLeadIds(workspaceId: string): Promise<Set<number>> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("wa_lead_exclusions")
      .select("lead_id")
      .eq("uchat_workspace_id", workspaceId);
    if (error) {
      console.error("[lead-exclusions] getExcludedLeadIds", { workspaceId, message: error.message });
      return new Set();
    }
    return new Set((data ?? []).map((r) => Number(r.lead_id)));
  } catch (e) {
    console.error("[lead-exclusions] getExcludedLeadIds threw", {
      workspaceId,
      error: e instanceof Error ? e.message : String(e),
    });
    return new Set();
  }
}

/** Lista pro painel "gerenciar ocultos" (mais recentes primeiro). */
export async function listExclusions(workspaceId: string): Promise<LeadExclusion[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_lead_exclusions")
    .select("lead_id, reason, nome_snapshot, telefone_snapshot, excluded_by, created_at")
    .eq("uchat_workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[lead-exclusions] listExclusions", { workspaceId, message: error.message });
    return [];
  }
  return (data ?? []).map((r) => ({
    lead_id: Number(r.lead_id),
    reason: r.reason ?? "teste",
    nome_snapshot: r.nome_snapshot ?? null,
    telefone_snapshot: r.telefone_snapshot ?? null,
    excluded_by: r.excluded_by ?? null,
    created_at: r.created_at,
  }));
}

export async function addExclusion(opts: {
  workspaceId: string;
  leadId: number;
  userId: string;
  reason?: string;
  nome?: string | null;
  telefone?: string | null;
}): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("wa_lead_exclusions").upsert(
    {
      uchat_workspace_id: opts.workspaceId,
      lead_id: opts.leadId,
      reason: opts.reason?.trim() || "teste",
      nome_snapshot: opts.nome ?? null,
      telefone_snapshot: opts.telefone ?? null,
      excluded_by: opts.userId,
      created_at: new Date().toISOString(),
    },
    { onConflict: "uchat_workspace_id,lead_id" },
  );
  if (error) {
    console.error("[lead-exclusions] addExclusion", { ...opts, message: error.message });
    return false;
  }
  return true;
}

export async function removeExclusion(workspaceId: string, leadId: number): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("wa_lead_exclusions")
    .delete()
    .eq("uchat_workspace_id", workspaceId)
    .eq("lead_id", leadId);
  if (error) {
    console.error("[lead-exclusions] removeExclusion", { workspaceId, leadId, message: error.message });
    return false;
  }
  return true;
}
