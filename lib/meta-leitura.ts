import "server-only";
import { getSupabaseAdmin } from "./supabase/server";

// Leitura genérica da Graph API para o Code da CS (MCP meta-ads), via Core.
//
// Por que existe (12/10/2026): o Code da Gabi lia a Meta com o token do
// Aton_Ads_Gestor, que só tem a conta da ERS (é o usuário de ESCRITA). Quem lê
// as contas de todos os assinantes é o Aton_Ads_API, cujo token vive só aqui
// (META_SYSTEM_USER_TOKEN). Em vez de colar esse token no PC de alguém, o Code
// pede a leitura ao Core (/api/cs-manutencao, acao meta_ler) e o Core repassa
// para cá. O token nunca sai deste serviço.
//
// Travas:
//  - só GET na Graph;
//  - conta (act_) só se estiver em wa_meta_ads_accounts com enabled = true;
//  - objeto numérico (campanha, conjunto, anúncio, criativo, público) só se o
//    account_id dele for uma dessas contas; vídeo e pixel (não têm account_id)
//    só com campos e arestas de leitura de mídia/estatística;
//  - arestas numa lista fechada (as que o MCP usa);
//  - paging.next/previous saem (a URL traz o token); o chamador pagina pelo
//    cursor `after`.

const G = "https://graph.facebook.com/v23.0";

const ARESTAS_CONTA = new Set([
  "",
  "insights",
  "campaigns",
  "adsets",
  "ads",
  "adcreatives",
  "activities",
  "adspixels",
  "customaudiences",
  "adrules_library",
  "promote_pages",
  "adimages",
  "advideos",
  "reachestimate",
  "delivery_estimate",
  "targetingsearch",
]);
const ARESTAS_OBJETO = new Set(["", "insights", "adsets", "ads", "adcreatives", "thumbnails", "previews"]);
/** Objetos sem account_id (vídeo, pixel): só estas arestas, ou a raiz com CAMPOS_MIDIA. */
const ARESTAS_SEM_CONTA = new Set(["thumbnails", "stats"]);
const CAMPOS_MIDIA = new Set([
  "id",
  "source",
  "length",
  "picture",
  "title",
  "description",
  "format",
  "status",
  "permalink_url",
  "created_time",
  "updated_time",
  "name",
  "last_fired_time",
]);
const PARAM_PROIBIDO = /^(access_token|appsecret_proof|method|batch)$/i;

export type LeituraResultado =
  | { ok: true; data: unknown }
  | { ok: false; status: number; erro: string; meta_error?: unknown };

let contasCache: { ts: number; contas: Set<string> } | null = null;
async function contasHabilitadas(): Promise<Set<string>> {
  if (contasCache && Date.now() - contasCache.ts < 5 * 60_000) return contasCache.contas;
  const { data, error } = await getSupabaseAdmin()
    .from("wa_meta_ads_accounts")
    .select("act_id")
    .eq("enabled", true);
  if (error) throw new Error(`wa_meta_ads_accounts: ${error.message}`);
  const contas = new Set(
    ((data as { act_id: string | null }[] | null) ?? [])
      .map((r) => normAct(r.act_id))
      .filter(Boolean),
  );
  contasCache = { ts: Date.now(), contas };
  return contas;
}

function normAct(a: string | null | undefined): string {
  const s = String(a ?? "").trim();
  if (!s) return "";
  const d = s.replace(/^act_/, "").replace(/\D/g, "");
  return d ? `act_${d}` : "";
}

function serializar(v: unknown): string {
  return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
}

async function graphGet(
  caminho: string,
  params: Record<string, string>,
  token: string,
): Promise<{ ok: boolean; status: number; j: Record<string, unknown> | null }> {
  const url = new URL(`${G}/${caminho}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const txt = await r.text();
  let j: Record<string, unknown> | null = null;
  try {
    j = JSON.parse(txt) as Record<string, unknown>;
  } catch {
    j = null;
  }
  return { ok: r.ok && !!j && !j.error, status: r.status, j };
}

/** Conta dona de um objeto numérico (null = o objeto não tem account_id: vídeo, pixel, página). */
const donoCache = new Map<string, { ts: number; conta: string | null }>();
async function contaDoObjeto(id: string, token: string): Promise<string | null | "erro"> {
  const hit = donoCache.get(id);
  if (hit && Date.now() - hit.ts < 30 * 60_000) return hit.conta;
  const r = await graphGet(id, { fields: "account_id" }, token);
  if (r.ok) {
    const conta = normAct((r.j?.account_id as string | undefined) ?? "") || null;
    donoCache.set(id, { ts: Date.now(), conta });
    return conta;
  }
  const code = Number((r.j?.error as { code?: number } | undefined)?.code);
  // 100 = o tipo não tem o campo account_id (vídeo, pixel). Qualquer outro erro
  // (sem permissão, objeto inexistente) recusa.
  if (code === 100) {
    donoCache.set(id, { ts: Date.now(), conta: null });
    return null;
  }
  return "erro";
}

function camposPedidos(params: Record<string, string>): string[] {
  return (params.fields ?? "")
    .split(",")
    .map((s) => s.trim().replace(/[{.(].*$/, ""))
    .filter(Boolean);
}

export async function lerGraph(caminhoBruto: unknown, paramsBrutos: unknown): Promise<LeituraResultado> {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) return { ok: false, status: 503, erro: "not_configured" };

  const caminho = String(caminhoBruto ?? "").trim().replace(/^\/+|\/+$/g, "");
  const m = /^(act_\d{5,}|\d{5,}|search)(?:\/([a-z_]+))?$/.exec(caminho);
  if (!m) return { ok: false, status: 400, erro: `caminho fora do contrato: ${caminho.slice(0, 80)}` };
  const raiz = m[1];
  const aresta = m[2] ?? "";

  const params: Record<string, string> = {};
  if (paramsBrutos && typeof paramsBrutos === "object") {
    for (const [k, v] of Object.entries(paramsBrutos as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      if (PARAM_PROIBIDO.test(k)) return { ok: false, status: 400, erro: `parâmetro proibido: ${k}` };
      const sv = serializar(v);
      if (/access_token/i.test(sv)) return { ok: false, status: 400, erro: "parâmetro proibido: access_token" };
      params[k] = sv;
    }
  }
  if (params.limit && Number(params.limit) > 500) params.limit = "500";

  try {
    if (raiz === "search") {
      if (aresta) return { ok: false, status: 400, erro: "search não tem aresta" };
      if (!/^ad[a-z_]*$/i.test(params.type ?? "")) {
        return { ok: false, status: 400, erro: "search só para segmentação (type=ad...)" };
      }
    } else if (raiz.startsWith("act_")) {
      if (!ARESTAS_CONTA.has(aresta)) return { ok: false, status: 400, erro: `aresta de conta não permitida: ${aresta}` };
      if (!(await contasHabilitadas()).has(normAct(raiz))) {
        return { ok: false, status: 403, erro: `conta ${raiz} não está ligada (wa_meta_ads_accounts enabled)` };
      }
    } else {
      const dono = await contaDoObjeto(raiz, token);
      if (dono === "erro") return { ok: false, status: 403, erro: `objeto ${raiz} não visível para leitura` };
      if (dono) {
        if (!ARESTAS_OBJETO.has(aresta)) return { ok: false, status: 400, erro: `aresta não permitida: ${aresta}` };
        if (!(await contasHabilitadas()).has(dono)) {
          return { ok: false, status: 403, erro: `objeto ${raiz} é de conta não ligada (${dono})` };
        }
      } else if (aresta) {
        if (!ARESTAS_SEM_CONTA.has(aresta)) return { ok: false, status: 400, erro: `aresta não permitida: ${aresta}` };
      } else {
        const fora = camposPedidos(params).filter((c) => !CAMPOS_MIDIA.has(c));
        if (!params.fields || fora.length) {
          return { ok: false, status: 400, erro: `campos não permitidos neste objeto: ${fora.join(",") || "(sem fields)"}` };
        }
      }
    }

    const r = await graphGet(caminho, params, token);
    if (!r.ok) {
      const e = (r.j?.error as Record<string, unknown> | undefined) ?? { message: `HTTP ${r.status}` };
      const limpo = {
        message: e.message,
        code: e.code,
        error_subcode: e.error_subcode,
        error_user_title: e.error_user_title,
        error_user_msg: e.error_user_msg,
      };
      return { ok: false, status: 422, erro: "meta_error", meta_error: limpo };
    }
    const j = r.j as Record<string, unknown>;
    const paging = j.paging as Record<string, unknown> | undefined;
    if (paging) {
      const tem_mais = !!paging.next;
      delete paging.next;
      delete paging.previous;
      paging.tem_mais = tem_mais;
    }
    return { ok: true, data: j };
  } catch (e) {
    return { ok: false, status: 502, erro: e instanceof Error ? e.message : String(e) };
  }
}
