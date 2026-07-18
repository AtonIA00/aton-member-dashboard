import "server-only";
import type { LeadAguardando, RetornoComercial } from "./types";

// Adapter da seção "Retorno do time comercial" (v1 — Opção 1: endpoint
// interno do Aton Core).
//
// O Core já calcula handoff (gatherHandoffMetrics), agora gateado em
// Agendado (N pequeno), com cache ~15min. O dash chama server-to-server com
// o INTERNAL_SHARED_SECRET (mesmo canal do openai-key/ton-system-prompt),
// passa o workspaceId e só renderiza. Régua idêntica garantida, zero
// duplicação, sem credencial UChat no dash.
//
// ⚠️ Path e shape EXATOS a confirmar pelo Core. Isolei o parsing em
// parseCoreResponse() — quando o shape final chegar, ajusta só ali.
//
// Degradação graciosa: QUALQUER falha (sem config, timeout, !ok, parse) →
// retorna null. A UI esconde a seção nesse caso — nunca mostra "0%".

// ── Gate ────────────────────────────────────────────────────────────────
// Feature flag global (kill-switch) + toggle por assinante. Enquanto o
// endpoint do Core não está no ar, MEMBER_DASHBOARD_RETORNO_COMERCIAL_ENABLED
// fica ausente/false → a seção sobe DARK (código presente, invisível).
// Feature DISPONÍVEL (kill-switch global). A visibilidade por assinante
// (ocultar/mostrar) é preferência separada: wa_member_dashboard_access
// .mostrar_retorno_comercial, controlada pela UI e passada como estado
// inicial do toggle — NÃO gateia a API (senão o clique em "mostrar" correria
// com o fetch). Aqui só a flag.
export function isRetornoComercialEnabled(): boolean {
  return process.env.MEMBER_DASHBOARD_RETORNO_COMERCIAL_ENABLED === "true";
}

// ── Cache em memória (15min por workspace) ────────────────────────────────
type CacheEntry = { ts: number; data: RetornoComercial };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 15 * 60_000;
const TIMEOUT_MS = 8_000;

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

// Ponto único de tradução Core → contrato do dash. Defensivo a campos
// ausentes. Ajustar aqui quando o Core confirmar o shape final.
function parseCoreResponse(json: unknown): RetornoComercial | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const listaRaw = Array.isArray(o.lista_aguardando) ? o.lista_aguardando : [];
  const lista_aguardando: LeadAguardando[] = listaRaw.map((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    return {
      nome: str(x.nome),
      telefone: str(x.telefone),
      campanha: str(x.campanha),
      agendado_em: str(x.agendado_em),
    };
  });
  return {
    janela_dias: num(o.janela_dias, 14),
    sla_min: num(o.sla_min, 30),
    agendados: num(o.agendados),
    retornados: num(o.retornados),
    aguardando: num(o.aguardando),
    nao_localizados: num(o.nao_localizados),
    dentro_sla: num(o.dentro_sla),
    mediana_util_min: num(o.mediana_util_min),
    lista_aguardando,
  };
}

// Sample pra dev/preview visual sem depender do Core.
// Ligar com MEMBER_DASHBOARD_RETORNO_COMERCIAL_MOCK=true.
// Espelha as realidades do payload real do Core (Royal ws 300729): nome pode
// vir "", telefone com +55, agendado_em já formatado "DD/MM, HH:MM", e
// mediana_util_min GRANDE (minutos úteis — pode passar de dias).
function mockData(): RetornoComercial {
  return {
    janela_dias: 14,
    sla_min: 30,
    agendados: 13,
    retornados: 9,
    aguardando: 3,
    nao_localizados: 1,
    dentro_sla: 7,
    mediana_util_min: 4992,
    lista_aguardando: [
      { nome: "Carolina Antoniazzi", telefone: "+5527999844698", campanha: "Royal View", agendado_em: "23/06, 14:50" },
      { nome: "", telefone: "+559188208412", campanha: "Royal View", agendado_em: "29/06, 13:46" },
      { nome: "Catarine 🍒", telefone: "+5527998921801", campanha: "Royal View", agendado_em: "01/07, 13:36" },
    ],
  };
}

export async function getRetornoComercial(
  workspaceId: string,
): Promise<RetornoComercial | null> {
  if (process.env.MEMBER_DASHBOARD_RETORNO_COMERCIAL_MOCK === "true") {
    return mockData();
  }

  const now = Date.now();
  const hit = cache.get(workspaceId);
  if (hit && now - hit.ts < TTL_MS) return hit.data;

  const coreUrl = process.env.ATON_CORE_INTERNAL_URL;
  const sharedSecret = process.env.INTERNAL_SHARED_SECRET;
  if (!coreUrl || !sharedSecret) {
    // Sem canal configurado → seção fica escondida (sem erro).
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // POST + body { workspace_id } + Bearer — mesmo shape do /api/internal/openai-key
    // (consistência com os endpoints internos do Core). O Core aceita
    // workspace_id ou uchat_workspace_id.
    const res = await fetch(`${coreUrl}/api/internal/retorno-comercial`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sharedSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
      cache: "no-store",
      signal: controller.signal,
    });
    // 404 = workspace_not_found_or_unconfigured (sem token no Core) — esperado;
    // seção some sem ruído de log.
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn("[retorno-comercial] core !ok", { workspaceId, status: res.status });
      return null;
    }
    const parsed = parseCoreResponse(await res.json());
    if (!parsed) return null;
    cache.set(workspaceId, { ts: now, data: parsed });
    return parsed;
  } catch (e) {
    console.warn("[retorno-comercial] fetch falhou", {
      workspaceId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
