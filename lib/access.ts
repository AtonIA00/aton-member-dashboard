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
  /** true quando o acesso foi concedido via bypass de super-admin (o workspace
   *  não está liberado, mas o viewer é Aton). A UI mostra um indicador. */
  superadminBypass: boolean;
};

/**
 * Super-admins da Aton (allowlist por env, CSV de user_ids Uchat). Concede:
 *   1. Ver QUALQUER workspace, mesmo não liberado (bypass do checkDashboardAccess).
 *   2. Marcar leads como teste (herdado em lib/lead-exclusions).
 * Vazio = ninguém (sobe dark). ⚠️ Dá leitura de PII de TODOS os assinantes —
 * só user_ids 100% confiáveis.
 */
export function isSuperAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.MEMBER_DASHBOARD_SUPERADMIN_ALLOWLIST ?? "";
  const set = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return set.size > 0 && set.has(String(userId));
}

// Grant sintético pra super-admin ver workspace não liberado: enterprise
// (acesso total, inclusive TON), sem datas de expiração.
function superadminGrant(): AccessGranted {
  return {
    granted: true,
    tier: "enterprise",
    habilitadoAt: null,
    expiresAt: null,
    daysUntilExpiry: null,
    hoursUntilExpiry: null,
    mostrarRetornoComercial: true,
    superadminBypass: true,
  };
}
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
 *
 * `viewerUserId` (do HMAC): se for super-admin Aton, qualquer caminho que
 * NEGARIA acesso (sem linha, desabilitado, expirado, erro de banco) vira um
 * grant sintético enterprise. Assim o super-admin vê qualquer workspace.
 */
export async function checkDashboardAccess(
  workspaceId: string,
  viewerUserId?: string | null,
): Promise<AccessResult> {
  const superadmin = isSuperAdmin(viewerUserId);
  const denyOrBypass = (): AccessResult =>
    superadmin ? superadminGrant() : { granted: false };

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
    return denyOrBypass();
  }
  if (!data) {
    return denyOrBypass();
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
      return denyOrBypass();
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
    superadminBypass: false,
  };
}
