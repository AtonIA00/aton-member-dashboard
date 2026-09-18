import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import type { DateRange } from "./period";

// Funil OUTBOUND (disparo ativo) — tabela public.disparos_outbound.
//
// Existe porque o dash foi desenhado para funil de ENTRADA: lead chega, o
// agente conversa, qualifica, converte. No outbound o começo é o oposto — a
// Aton dispara para uma base fria — e os números que importam ficam ANTES do
// primeiro "olá": quantos da base receberam mesmo a mensagem, quantos
// responderam, quantos viraram conversa. O funil de conversa do dash mostra
// só o fundo disso (na Lavvi, 29 dos 36 leads do CRM são exatamente quem
// respondeu ao disparo).
//
// A seção só aparece para quem TEM disparo: sem linha na tabela, retorna null
// e o dash dos outros assinantes não muda em nada.
//
// Quem escreve a tabela são os fluxos da Uchat, por PATCH. Aqui é SOMENTE
// LEITURA.

export type OutboundToque = { toque: number; enviados: number; responderam: number };

export type OutboundData = {
  campanhas: string[];
  /** Linhas no período — a base que a operação tentou alcançar. */
  base: number;
  /** status_envio='falha': o WhatsApp não saiu. Defeito de ENVIO, não de
   *  mensagem — por isso aparece destacado e fora da taxa de resposta. */
  falha: number;
  /** base - falha. É o denominador honesto de tudo que vem depois. */
  entregues: number;
  responderam: number;
  converteram: number;
  pctEntrega: number;
  /** responderam ÷ entregues. Sobre o TOTAL daria um número menor por defeito
   *  de envio, não por desempenho da mensagem (na Lavvi: 5,9% vs 4,3%). */
  pctResposta: number;
  pctConversaoResp: number;
  pctConversaoEntregue: number;
  /** Entregues nas últimas 24h: a janela de resposta ainda não fechou, então
   *  a taxa do período ainda pode subir. Medido na Lavvi: 85% das respostas
   *  chegam em ATÉ 1 HORA e 25 de 26 em 24h — 24h é régua folgada. */
  emVoo: number;
  /** Mediana de horas até a 1ª resposta (null = ninguém respondeu ainda). */
  horasMediana: number | null;
  pctAte1h: number | null;
  /** Em qual mensagem do disparo a pessoa respondeu. */
  porTentativa: Array<{ tentativa: number; n: number }>;
  /** Respondentes que têm esse dado. O PATCH de tentativa é recente: NULL ali
   *  não é "não respondeu", é "não sabemos em qual". */
  tentativaCobertura: number;
  /** Esteira de retomada (5 toques). */
  retomada: OutboundToque[];
  /** false = a esteira ainda não gravou nada (fluxos não publicados ou lead
   *  ainda não chegou a +1 dia). NÃO é zero de desempenho. */
  retomadaAtiva: boolean;
  /** convertido=true sem respondeu=true. Os nós de conversão gravam só
   *  `convertido`, e o PATCH de resposta tem trava de idempotência — dá para
   *  chegar num sem passar pelo outro. Inconsistência a mostrar, não a
   *  esconder. */
  convertidoSemResposta: number;
};

type Row = {
  campanha: string | null;
  status_envio: string | null;
  respondeu: boolean | null;
  convertido: boolean | null;
  disparo_at: string | null;
  primeira_resposta_at: string | null;
  respondeu_na_tentativa: number | null;
  retomada_toque: number | null;
  retomada_respondeu_em: number | null;
};

const PAGE = 1000;
const HARD_CAP = 20_000;

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const div = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * null = workspace sem NENHUM disparo (a seção não existe pra ele) ou erro de
 * banco. Erro degrada silencioso: o resto do dash não pode cair por causa
 * disto.
 */
export async function getOutboundData(
  workspaceId: string,
  range: DateRange,
): Promise<OutboundData | null> {
  const supabase = getSupabaseAdmin();

  // Gate barato: o workspace tem disparo alguma vez? Índice em
  // (workspace_id, campanha). Sem isso, sai fora sem varrer nada.
  const { count, error: errCount } = await supabase
    .from("disparos_outbound")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (errCount) {
    console.error("[outbound] gate falhou", { workspaceId, message: errCount.message });
    return null;
  }
  if (!count) return null;

  // Mesma paginação do fetchBaseLeads (PostgREST corta em 1000).
  const rows: Row[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    let q = supabase
      .from("disparos_outbound")
      .select(
        "campanha, status_envio, respondeu, convertido, disparo_at, primeira_resposta_at, respondeu_na_tentativa, retomada_toque, retomada_respondeu_em",
      )
      .eq("workspace_id", workspaceId)
      .order("disparo_at", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (range.from) q = q.gte("disparo_at", `${range.from}T00:00:00Z`);
    if (range.to) q = q.lte("disparo_at", `${range.to}T23:59:59.999Z`);

    const { data, error } = await q;
    if (error) {
      console.error("[outbound] busca falhou", { workspaceId, offset, message: error.message });
      return null;
    }
    const chunk = (data ?? []) as Row[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }

  // Período sem disparo: a seção aparece zerada em vez de sumir — sumir faria
  // o leitor achar que a operação não existe, quando ela só não disparou aqui.
  const base = rows.length;
  const falha = rows.filter((r) => r.status_envio === "falha").length;
  const entregues = base - falha;
  const entreguesRows = rows.filter((r) => r.status_envio !== "falha");
  const responderam = entreguesRows.filter((r) => r.respondeu === true).length;
  const converteram = entreguesRows.filter((r) => r.convertido === true).length;

  const agora = Date.now();
  const emVoo = entreguesRows.filter(
    (r) => r.disparo_at && agora - new Date(r.disparo_at).getTime() < 24 * 3_600_000,
  ).length;

  const horas: number[] = [];
  for (const r of rows) {
    if (!r.disparo_at || !r.primeira_resposta_at) continue;
    const h = (new Date(r.primeira_resposta_at).getTime() - new Date(r.disparo_at).getTime()) / 3_600_000;
    if (Number.isFinite(h) && h >= 0) horas.push(h);
  }

  const tentativaMap = new Map<number, number>();
  for (const r of rows) {
    const t = r.respondeu_na_tentativa;
    if (t == null) continue;
    tentativaMap.set(t, (tentativaMap.get(t) ?? 0) + 1);
  }

  const retomada: OutboundToque[] = [1, 2, 3, 4, 5].map((toque) => ({
    toque,
    enviados: rows.filter((r) => (r.retomada_toque ?? 0) >= toque).length,
    responderam: rows.filter((r) => r.retomada_respondeu_em === toque).length,
  }));

  return {
    campanhas: [...new Set(rows.map((r) => r.campanha).filter((c): c is string => !!c))].sort(),
    base,
    falha,
    entregues,
    responderam,
    converteram,
    pctEntrega: r1(div(entregues, base)),
    pctResposta: r1(div(responderam, entregues)),
    pctConversaoResp: r1(div(converteram, responderam)),
    pctConversaoEntregue: r1(div(converteram, entregues)),
    emVoo,
    horasMediana: horas.length ? r1(mediana(horas) ?? 0) : null,
    pctAte1h: horas.length ? r1(div(horas.filter((h) => h < 1).length, horas.length)) : null,
    porTentativa: [...tentativaMap].map(([tentativa, n]) => ({ tentativa, n })).sort((a, b) => a.tentativa - b.tentativa),
    tentativaCobertura: [...tentativaMap.values()].reduce((s, n) => s + n, 0),
    retomada,
    retomadaAtiva: retomada.some((t) => t.enviados > 0 || t.responderam > 0),
    convertidoSemResposta: rows.filter((r) => r.convertido === true && r.respondeu !== true).length,
  };
}
