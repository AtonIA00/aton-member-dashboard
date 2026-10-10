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

// O PostgREST devolve no máximo 1.000 linhas por chamada, CALADO: sem
// paginar, a partir do lead 1.001 marcado como teste os demais voltavam ao
// dashboard. Com a marcação em lote ("teste de implantação", 09/10/2026) uma
// workspace passa disso fácil. Toda leitura desta tabela pagina por range.
const PAGINA = 1000;

/**
 * Ids excluídos do workspace. SEM cache — o marcar/restaurar precisa
 * refletir na hora no router.refresh(). Paginado (ver PAGINA).
 * Falha silenciosa (retorna Set vazio) pra nunca derrubar o dashboard.
 */
export async function getExcludedLeadIds(workspaceId: string): Promise<Set<number>> {
  try {
    const supabase = getSupabaseAdmin();
    const out = new Set<number>();
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from("wa_lead_exclusions")
        .select("lead_id")
        .eq("uchat_workspace_id", workspaceId)
        .order("lead_id", { ascending: true })
        .range(de, de + PAGINA - 1);
      if (error) {
        console.error("[lead-exclusions] getExcludedLeadIds", { workspaceId, message: error.message });
        return new Set();
      }
      for (const r of data ?? []) out.add(Number(r.lead_id));
      if (!data || data.length < PAGINA) break;
    }
    return out;
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
  const linhas: Array<Record<string, unknown> & { created_at: string }> = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("wa_lead_exclusions")
      .select("lead_id, reason, nome_snapshot, telefone_snapshot, excluded_by, created_at")
      .eq("uchat_workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .order("lead_id", { ascending: false })
      .range(de, de + PAGINA - 1);
    if (error) {
      console.error("[lead-exclusions] listExclusions", { workspaceId, message: error.message });
      return [];
    }
    linhas.push(...((data ?? []) as typeof linhas));
    if (!data || data.length < PAGINA) break;
  }
  return linhas.map((r) => ({
    lead_id: Number(r.lead_id),
    reason: (r.reason as string | null) ?? "teste",
    nome_snapshot: (r.nome_snapshot as string | null) ?? null,
    telefone_snapshot: (r.telefone_snapshot as string | null) ?? null,
    excluded_by: (r.excluded_by as string | null) ?? null,
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

// ── Marcação em lote: "teste de implantação" (09/10/2026) ──────────────────
// Quando o assinante termina a implantação, os leads de antes são teste.
// Duas portas gravam aqui com o mesmo motivo: esta rota e a ação
// excluir_teste_ate do cs-manutencao do Core (PR #518). Regras comuns:
//   · nunca sobrescreve uma marcação existente (motivo/autor originais ficam);
//   · conferência obrigatória antes de gravar (contagem, depois confirmar);
//   · no máximo LOTE_MAX novos por vez.

export const MOTIVO_IMPLANTACAO = "teste de implantação";
export const LOTE_MAX = 5000;

type Candidato = { id: number; nome: string | null; telefone: string | null; data: string | null };

export type LoteResumo = {
  /** Leads da workspace que o critério pegou. */
  total: number;
  /** Desses, quantos já estavam marcados (ficam como estão). */
  ja_marcados: number;
  /** Quantos serão (ou foram) marcados agora. */
  a_marcar: number;
  /** lead_ids pedidos que não são desta workspace (ignorados). */
  ignorados: number;
  /** Data (AAAA-MM-DD) do lead mais antigo e do mais recente do critério. */
  data_min: string | null;
  data_max: string | null;
  acima_do_limite: boolean;
};

function telefoneSnapshot(ddd: unknown, tel: unknown): string | null {
  const t = String(tel ?? "").trim();
  if (!t) return null;
  const d = String(ddd ?? "").trim();
  return d && !t.startsWith(d) && !t.startsWith(`+${d}`) ? `(${d}) ${t}` : t;
}

/** Resolve os leads do critério, SEMPRE restritos à workspace. */
async function candidatosDoLote(
  workspaceId: string,
  criterio: { leadIds: number[] } | { ate: string },
): Promise<{ leads: Candidato[]; ignorados: number } | null> {
  const supabase = getSupabaseAdmin();
  const campos = "id, data, nome_lead, telefone, ddd_lead";
  const leads: Candidato[] = [];
  const add = (r: Record<string, unknown>) =>
    leads.push({
      id: Number(r.id),
      nome: (r.nome_lead as string | null) ?? null,
      telefone: telefoneSnapshot(r.ddd_lead, r.telefone),
      data: typeof r.data === "string" ? r.data.slice(0, 10) : null,
    });

  if ("ate" in criterio) {
    // `data` é o dia de Brasília à meia-noite UTC: "até 08/10" = lte 08/10 23:59Z.
    // Teto de leitura de 4× o lote: acima disso o resumo já sai "acima do
    // limite" de qualquer jeito.
    for (let de = 0; de < LOTE_MAX * 4; de += PAGINA) {
      const { data, error } = await supabase
        .from("terrace360_leads_atonhub")
        .select(campos)
        .eq("id_workspace_responsavel", workspaceId)
        .lte("data", `${criterio.ate}T23:59:59.999Z`)
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);
      if (error) {
        console.error("[lead-exclusions] candidatos ate", { workspaceId, message: error.message });
        return null;
      }
      for (const r of data ?? []) add(r);
      if (!data || data.length < PAGINA) break;
    }
    return { leads, ignorados: 0 };
  }

  const pedidos = [...new Set(criterio.leadIds)];
  for (let i = 0; i < pedidos.length; i += 500) {
    const { data, error } = await supabase
      .from("terrace360_leads_atonhub")
      .select(campos)
      .eq("id_workspace_responsavel", workspaceId)
      .in("id", pedidos.slice(i, i + 500));
    if (error) {
      console.error("[lead-exclusions] candidatos ids", { workspaceId, message: error.message });
      return null;
    }
    for (const r of data ?? []) add(r);
  }
  return { leads, ignorados: pedidos.length - leads.length };
}

/**
 * Conferência (confirmar=false) ou gravação (confirmar=true) do lote. Na
 * gravação a contagem é refeita na hora, então grava o que existe agora, não
 * o que a tela viu. null = falha de banco.
 */
export async function marcarLote(opts: {
  workspaceId: string;
  userId: string;
  criterio: { leadIds: number[] } | { ate: string };
  confirmar: boolean;
}): Promise<(LoteResumo & { gravados: number }) | null> {
  const res = await candidatosDoLote(opts.workspaceId, opts.criterio);
  if (!res) return null;
  const marcados = await getExcludedLeadIds(opts.workspaceId);
  const novos = res.leads.filter((l) => !marcados.has(l.id));
  const datas = res.leads
    .map((l) => l.data)
    .filter((d): d is string => !!d)
    .sort();
  const resumo: LoteResumo = {
    total: res.leads.length,
    ja_marcados: res.leads.length - novos.length,
    a_marcar: novos.length,
    ignorados: res.ignorados,
    data_min: datas[0] ?? null,
    data_max: datas[datas.length - 1] ?? null,
    acima_do_limite: novos.length > LOTE_MAX,
  };
  if (!opts.confirmar || resumo.acima_do_limite || novos.length === 0) {
    return { ...resumo, gravados: 0 };
  }

  const supabase = getSupabaseAdmin();
  const agora = new Date().toISOString();
  let gravados = 0;
  for (let i = 0; i < novos.length; i += 500) {
    const lote = novos.slice(i, i + 500).map((l) => ({
      uchat_workspace_id: opts.workspaceId,
      lead_id: l.id,
      reason: MOTIVO_IMPLANTACAO,
      nome_snapshot: l.nome,
      telefone_snapshot: l.telefone,
      excluded_by: opts.userId,
      created_at: agora,
    }));
    // ignoreDuplicates: se a outra porta (o Core) marcou no meio do caminho,
    // a marcação dela fica intacta.
    const { error } = await supabase
      .from("wa_lead_exclusions")
      .upsert(lote, { onConflict: "uchat_workspace_id,lead_id", ignoreDuplicates: true });
    if (error) {
      console.error("[lead-exclusions] marcarLote", {
        workspaceId: opts.workspaceId,
        gravados,
        message: error.message,
      });
      return { ...resumo, gravados };
    }
    gravados += lote.length;
  }
  return { ...resumo, gravados };
}
