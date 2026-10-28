import "server-only";

// Etapas do lead no CV (o CRM da construtora), lead a lead — SOMENTE LEITURA.
// 28/10/2026, WDS (338565): o funil do dash parava em "Convertido" (o lead
// foi passado ao CV). Daí para frente quem sabe é o CV: corretor, primeiro
// atendimento, visita feita, venda. O Core guarda o envio (cv_envios com
// idlead_cv) e consulta o CV; o dash pergunta ao Core.
//
//   GET ${ATON_CORE_INTERNAL_URL}/api/internal/cv-leads?workspace_id=&de=
//   Authorization: Bearer INTERNAL_SHARED_SECRET
//   200 { gerado_em, leads: CvLead[] }   404 = workspace sem CV   502 = CV fora
//
// O Core já tira os leads de teste e os que nunca foram ao CV. Etapa é
// cumulativa (no_cv < com_corretor < em_atendimento < visita < venda);
// "perdido" só vem quando não houve visita nem venda. visita_em é visita
// REALIZADA (tarefa concluída no CV), não agendada.
//
// A primeira chamada do Core leva ~4,5 s (lê 4 bases do CV) e depois ele
// guarda 5 min. Aqui: 4 s de prazo para a página não esperar; se estourar, a
// busca segue em segundo plano e preenche o cache, e o funil aparece até
// "Atendido" nesta abertura. Qualquer falha → null, nunca quebra o dash.

export type CvEtapa = "no_cv" | "com_corretor" | "em_atendimento" | "visita" | "venda" | "perdido";

export type CvLead = {
  lead_id: number | null;
  telefone: string | null;
  id_anuncio: string | null;
  idlead_cv: number | null;
  enviado_cv_em: string | null;
  situacao: string | null;
  etapa: CvEtapa;
  corretor: string | null;
  data_cad: string | null;
  distribuido_em: string | null;
  primeiro_atendimento_em: string | null;
  visita_em: string | null;
  venda_em: string | null;
  atualizado_em: string | null;
};

const ETAPAS = new Set<CvEtapa>(["no_cv", "com_corretor", "em_atendimento", "visita", "venda", "perdido"]);
const TTL_MS = 5 * 60_000;
const DEADLINE_MS = 4_000;
const TIMEOUT_MS = 20_000;

const cache = new Map<string, { ts: number; data: CvLead[] }>();
const emVoo = new Map<string, Promise<CvLead[] | null>>();

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parse(json: unknown): CvLead[] | null {
  const leads = (json as { leads?: unknown })?.leads;
  if (!Array.isArray(leads)) return null;
  return leads.map((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const etapa = str(x.etapa) as CvEtapa | null;
    return {
      lead_id: num(x.lead_id),
      telefone: str(x.telefone),
      id_anuncio: x.id_anuncio == null ? null : String(x.id_anuncio).trim() || null,
      idlead_cv: num(x.idlead_cv),
      enviado_cv_em: str(x.enviado_cv_em),
      situacao: str(x.situacao),
      etapa: etapa && ETAPAS.has(etapa) ? etapa : "no_cv",
      corretor: str(x.corretor),
      data_cad: str(x.data_cad),
      distribuido_em: str(x.distribuido_em),
      primeiro_atendimento_em: str(x.primeiro_atendimento_em),
      visita_em: str(x.visita_em),
      venda_em: str(x.venda_em),
      atualizado_em: str(x.atualizado_em),
    };
  });
}

async function buscar(workspaceId: string, de: string): Promise<CvLead[] | null> {
  const coreUrl = process.env.ATON_CORE_INTERNAL_URL;
  const secret = process.env.INTERNAL_SHARED_SECRET;
  if (!coreUrl || !secret) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${coreUrl}/api/internal/cv-leads?workspace_id=${encodeURIComponent(workspaceId)}&de=${de}`,
      { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: controller.signal },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn("[cv-leads] core !ok", { workspaceId, status: res.status });
      return null;
    }
    const data = parse(await res.json());
    if (data) cache.set(`${workspaceId}|${de}`, { ts: Date.now(), data });
    return data;
  } catch (e) {
    console.warn("[cv-leads] fetch falhou", {
      workspaceId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Leads da WDS no CV a partir de `de` (AAAA-MM-DD). null = indisponível agora. */
export async function getCvLeads(workspaceId: string, de: string): Promise<CvLead[] | null> {
  const key = `${workspaceId}|${de}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

  let p = emVoo.get(key);
  if (!p) {
    p = buscar(workspaceId, de).finally(() => emVoo.delete(key));
    emVoo.set(key, p);
  }
  const prazo = new Promise<null>((r) => setTimeout(() => r(null), DEADLINE_MS));
  const res = await Promise.race([p, prazo]);
  // Estourou o prazo mas há cópia antiga: melhor um retrato de minutos atrás
  // do que funil cortado.
  return res ?? hit?.data ?? null;
}

const ORDEM: Record<CvEtapa, number> = {
  perdido: 0,
  no_cv: 1,
  com_corretor: 2,
  em_atendimento: 3,
  visita: 4,
  venda: 5,
};

/** O lead chegou pelo menos até `etapa`? (cumulativo; "perdido" fica só em no_cv) */
export function chegouAte(l: CvLead, etapa: Exclude<CvEtapa, "perdido">): boolean {
  if (etapa === "visita") return l.visita_em != null || ORDEM[l.etapa] >= ORDEM.visita;
  if (etapa === "venda") return l.venda_em != null || l.etapa === "venda";
  if (l.etapa === "perdido") {
    // Perdido depois de ter corretor: o CV diz quem pegou.
    if (etapa === "no_cv") return true;
    if (etapa === "com_corretor") return l.corretor != null || l.distribuido_em != null;
    return l.primeiro_atendimento_em != null;
  }
  return ORDEM[l.etapa] >= ORDEM[etapa];
}
