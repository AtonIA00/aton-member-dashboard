import "server-only";
import { getSupabaseAdmin } from "./supabase/server";

export type Tier = "trial" | "pro" | "enterprise";

export type AccessRow = {
  tier: Tier;
  habilitado: boolean;
  expira_em: string | null; // ISO timestamp ou null (sem expiração)
  habilitado_em: string | null; // ISO timestamp da data em que CS liberou
  mostrar_retorno_comercial: boolean | null; // toggle da seção Retorno (default true)
};

export type AccessGranted = {
  granted: true;
  tier: Tier;
  /** ISO timestamp de quando foi habilitado (pro tooltip do badge). */
  habilitadoAt: Date | null;
  expiresAt: Date | null;
  /** Dias inteiros até expirar (arredondado pra cima). null = sem expiração. */
  daysUntilExpiry: number | null;
  /** Horas inteiras até expirar (arredondado pra cima). null = sem expiração.
   *  Usado pelo TierBadge na faixa <24h. */
  hoursUntilExpiry: number | null;
  /** Toggle da seção "Retorno do time comercial" (default true). */
  mostrarRetornoComercial: boolean;
};
export type AccessDenied = { granted: false };
export type AccessResult = AccessGranted | AccessDenied;

/**
 * Verifica se uma workspace tem dashboard habilitado.
 *
 * Regra:
 *   SELECT * FROM wa_member_dashboard_access
 *   WHERE uchat_workspace_id = $1
 *     AND habilitado = true
 *     AND (expira_em IS NULL OR expira_em > now())
 *
 * Falha silenciosa em qualquer erro de banco — retorna `granted: false`.
 */
export async function checkDashboardAccess(workspaceId: string): Promise<AccessResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_member_dashboard_access")
    .select("tier, habilitado, expira_em, habilitado_em, mostrar_retorno_comercial")
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

  // habilitado_em: pode ser null em rows antigas — defensivo.
  let habilitadoAt: Date | null = null;
  if (data.habilitado_em) {
    const d = new Date(data.habilitado_em);
    if (!Number.isNaN(d.getTime())) habilitadoAt = d;
  }

  // expira_em: null = sem expiração (pro/enterprise). Caso vencido, recusa.
  let expiresAt: Date | null = null;
  let daysUntilExpiry: number | null = null;
  let hoursUntilExpiry: number | null = null;
  if (data.expira_em) {
    expiresAt = new Date(data.expira_em);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return { granted: false };
    }
    const msLeft = expiresAt.getTime() - Date.now();
    daysUntilExpiry = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    hoursUntilExpiry = Math.ceil(msLeft / (1000 * 60 * 60));
  }

  return {
    granted: true,
    tier: data.tier,
    habilitadoAt,
    expiresAt,
    daysUntilExpiry,
    hoursUntilExpiry,
    // Default true: rows antigas sem a coluna, ou null, contam como ligado.
    mostrarRetornoComercial: data.mostrar_retorno_comercial !== false,
  };
}
