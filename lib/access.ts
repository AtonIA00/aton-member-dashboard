import "server-only";
import { getSupabaseAdmin } from "./supabase/server";

export type Tier = "trial" | "pro" | "enterprise";

export type AccessRow = {
  tier: Tier;
  habilitado: boolean;
  expira_em: string | null; // ISO timestamp ou null (sem expiração)
};

export type AccessGranted = {
  granted: true;
  tier: Tier;
  expiresAt: Date | null;
  /** Dias inteiros até expirar (arredondado pra cima). null = sem expiração. */
  daysUntilExpiry: number | null;
};
export type AccessDenied = { granted: false };
export type AccessResult = AccessGranted | AccessDenied;

/**
 * Verifica se uma workspace tem dashboard habilitado.
 *
 * Replica a regra:
 *   SELECT 1 FROM wa_member_dashboard_access
 *   WHERE uchat_workspace_id = $1
 *     AND habilitado = true
 *     AND (expira_em IS NULL OR expira_em > now())
 *
 * Falha silenciosa em qualquer erro de banco — retorna `granted: false`.
 * O erro é logado server-side (sem PII) pra debug.
 */
export async function checkDashboardAccess(workspaceId: string): Promise<AccessResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_member_dashboard_access")
    .select("tier, habilitado, expira_em")
    .eq("uchat_workspace_id", workspaceId)
    .eq("habilitado", true)
    .maybeSingle<AccessRow>();

  if (error) {
    console.error("[access] supabase error", {
      workspaceId,
      code: error.code,
      message: error.message,
    });
    return { granted: false };
  }
  if (!data) {
    return { granted: false };
  }

  // Filtro de expiração aplicado no client (a single-row query não suporta
  // OR condicional limpo no .or() do supabase-js sem string-eval).
  let expiresAt: Date | null = null;
  let daysUntilExpiry: number | null = null;
  if (data.expira_em) {
    expiresAt = new Date(data.expira_em);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return { granted: false };
    }
    const msLeft = expiresAt.getTime() - Date.now();
    daysUntilExpiry = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  }

  return {
    granted: true,
    tier: data.tier,
    expiresAt,
    daysUntilExpiry,
  };
}
