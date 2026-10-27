import "server-only";
import { getSupabaseAdmin } from "./supabase/server";
import type { DateRange } from "./period";

// Funil OUTBOUND (disparo ativo) — tabela public.disparos_outbound.
//
// Existe porque o dash foi desenhado para funil de ENTRADA: lead chega, o
// agente conversa, qualifica, converte. No outbound o começo é o oposto — a
// Aton dispara para uma base fria — e os números que importam ficam ANTES do
// primeiro "olá": quantos da base receberam mesmo a mensagem, quantos
// responderam, quantos pediram para parar, quantos avançaram.
//
// A seção só aparece para quem TEM disparo: sem linha na tabela, retorna null
// e o dash dos outros assinantes não muda em nada.
//
// Quem escreve a tabela são os fluxos da Uchat, por PATCH. Aqui é SOMENTE
// LEITURA.
//
// 27/10/2026 (ativação da base da Lavvi, ~500 mil contatos em remessas): a
// soma passou para o banco, na função public.outbound_resumo (migração em
// supabase/migrations/20261027_outbound_resumo.sql). Ler linha a linha
// tinha teto de 20 mil e misturava todas as campanhas num número só. Agora
// sai pronto por campanha (cada hipótese de template), por remessa (dia do
// disparo em Brasília) e no total, com opt-out como métrica própria.

export type OutboundToque = { toque: number; enviados: number; responderam: number };

/** Uma linha das tabelas por campanha e por remessa. */
export type OutboundLinha = {
  /** Nome da campanha, ou o dia (AAAA-MM-DD) na visão por remessa. */
  chave: string;
  base: number;
  falha: number;
  entregues: number;
  optout: number;
  semResposta: number;
  responderam: number;
  converteram: number;
  pctEntrega: number;
  /** Todas as taxas abaixo são sobre ENTREGUES, salvo pctConversaoResp. */
  pctResposta: number;
  pctOptout: number;
  pctConversaoEntregue: number;
  pctConversaoResp: number;
  /** Mediana de horas até a 1ª resposta (null = ninguém respondeu). */
  horasMediana: number | null;
  /** Respostas na 1ª a 5ª mensagem (índice 0 = abertura). */
  porTentativa: number[];
  /** Entregues há menos de 24h: a taxa de resposta ainda pode subir. */
  emVoo: number;
};

export type OutboundVisao = {
  campanhas: string[];
  /** Linhas no período — a base que a operação tentou alcançar. */
  base: number;
  /** A mensagem não saiu. Defeito de ENVIO, não de mensagem — por isso fica
   *  fora das taxas. Linha marcada como falha mas que respondeu conta como
   *  entregue (a mensagem chegou). */
  falha: number;
  /** base - falha. É o denominador honesto de tudo que vem depois. */
  entregues: number;
  responderam: number;
  converteram: number;
  /** Tocou "Parar". Recebeu a mensagem (conta como entregue) e é o risco de
   *  qualidade do número na Meta: decisivo em base grande. */
  optout: number;
  /** 5 toques sem resposta. */
  semResposta: number;
  pctEntrega: number;
  /** responderam ÷ entregues. Sobre o TOTAL daria um número menor por defeito
   *  de envio, não por desempenho da mensagem. */
  pctResposta: number;
  pctOptout: number;
  pctConversaoResp: number;
  pctConversaoEntregue: number;
  emVoo: number;
  horasMediana: number | null;
  pctAte1h: number | null;
  /** Em qual mensagem do disparo a pessoa respondeu. */
  porTentativa: Array<{ tentativa: number; n: number }>;
  /** Respondentes que têm esse dado. NULL ali não é "não respondeu", é "não
   *  sabemos em qual". */
  tentativaCobertura: number;
  /** Esteira de retomada (5 toques). */
  retomada: OutboundToque[];
  /** false = a esteira ainda não gravou nada. NÃO é zero de desempenho. */
  retomadaAtiva: boolean;
  /** convertido=true sem respondeu=true: gravados por caminhos diferentes. */
  convertidoSemResposta: number;
  porCampanha: OutboundLinha[];
  /** Mais recente primeiro. */
  porRemessa: OutboundLinha[];
};

/** Visão sem as campanhas de teste nos campos de topo (é o padrão da tela);
 *  `comTestes` é a mesma coisa incluindo os testes, quando existem no
 *  período (null = nenhum teste no período). */
export type OutboundData = OutboundVisao & {
  comTestes: OutboundVisao | null;
  /** Disparos de teste no período (campanha começa com "teste"). */
  testes: number;
};

type RpcRow = {
  nivel: "campanha" | "remessa" | "total";
  campanha: string | null;
  dia: string | null;
  base: number;
  falha: number;
  entregues: number;
  optout: number;
  sem_resposta: number;
  responderam: number;
  converteram: number;
  conv_sem_resp: number;
  em_voo: number;
  mediana_h: number | null;
  n_horas: number;
  ate_1h: number;
  t1: number; t2: number; t3: number; t4: number; t5: number;
  ret_env1: number; ret_env2: number; ret_env3: number; ret_env4: number; ret_env5: number;
  ret_resp1: number; ret_resp2: number; ret_resp3: number; ret_resp4: number; ret_resp5: number;
};

const div = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
// bigint chega do PostgREST como número (ou string em valores enormes).
const n = (v: unknown) => Number(v ?? 0) || 0;

function linha(r: RpcRow, chave: string): OutboundLinha {
  const entregues = n(r.entregues);
  const responderam = n(r.responderam);
  return {
    chave,
    base: n(r.base),
    falha: n(r.falha),
    entregues,
    optout: n(r.optout),
    semResposta: n(r.sem_resposta),
    responderam,
    converteram: n(r.converteram),
    pctEntrega: r1(div(entregues, n(r.base))),
    pctResposta: r1(div(responderam, entregues)),
    pctOptout: r1(div(n(r.optout), entregues)),
    pctConversaoEntregue: r1(div(n(r.converteram), entregues)),
    pctConversaoResp: r1(div(n(r.converteram), responderam)),
    horasMediana: r.mediana_h == null ? null : r1(Number(r.mediana_h)),
    porTentativa: [n(r.t1), n(r.t2), n(r.t3), n(r.t4), n(r.t5)],
    emVoo: n(r.em_voo),
  };
}

function montarVisao(rows: RpcRow[]): OutboundVisao {
  const tot = rows.find((r) => r.nivel === "total");
  const porCampanha = rows
    .filter((r) => r.nivel === "campanha")
    .map((r) => linha(r, r.campanha ?? "Sem campanha"))
    .sort((a, b) => b.base - a.base);
  const porRemessa = rows
    .filter((r) => r.nivel === "remessa" && r.dia)
    .map((r) => linha(r, String(r.dia).slice(0, 10)))
    .sort((a, b) => b.chave.localeCompare(a.chave));

  // Período sem disparo: a função não devolve linha nenhuma. A seção aparece
  // zerada em vez de sumir — sumir faria o leitor achar que a operação não
  // existe, quando ela só não disparou aqui.
  const t = tot ?? ({ nivel: "total" } as RpcRow);
  const total = linha(t, "total");
  const tent = total.porTentativa;
  const retomada: OutboundToque[] = [1, 2, 3, 4, 5].map((toque) => ({
    toque,
    enviados: n(t[`ret_env${toque}` as keyof RpcRow]),
    responderam: n(t[`ret_resp${toque}` as keyof RpcRow]),
  }));
  const nHoras = n(t.n_horas);

  return {
    campanhas: porCampanha.map((c) => c.chave).sort(),
    base: total.base,
    falha: total.falha,
    entregues: total.entregues,
    responderam: total.responderam,
    converteram: total.converteram,
    optout: total.optout,
    semResposta: total.semResposta,
    pctEntrega: total.pctEntrega,
    pctResposta: total.pctResposta,
    pctOptout: total.pctOptout,
    pctConversaoResp: total.pctConversaoResp,
    pctConversaoEntregue: total.pctConversaoEntregue,
    emVoo: total.emVoo,
    horasMediana: total.horasMediana,
    pctAte1h: nHoras ? r1(div(n(t.ate_1h), nHoras)) : null,
    porTentativa: tent
      .map((qtd, i) => ({ tentativa: i + 1, n: qtd }))
      .filter((x) => x.n > 0),
    tentativaCobertura: tent.reduce((s, x) => s + x, 0),
    retomada,
    retomadaAtiva: retomada.some((x) => x.enviados > 0 || x.responderam > 0),
    convertidoSemResposta: n(t.conv_sem_resp),
    porCampanha,
    porRemessa,
  };
}

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
  // (workspace_id, campanha). Sem isso, sai fora sem chamar a função.
  const { count, error: errCount } = await supabase
    .from("disparos_outbound")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (errCount) {
    console.error("[outbound] gate falhou", { workspaceId, message: errCount.message });
    return null;
  }
  if (!count) return null;

  const chamar = (incluirTestes: boolean) =>
    supabase.rpc("outbound_resumo", {
      p_ws: workspaceId,
      p_de: range.from,
      p_ate: range.to,
      p_incluir_testes: incluirTestes,
    });
  const [sem, com] = await Promise.all([chamar(false), chamar(true)]);
  if (sem.error || com.error) {
    console.error("[outbound] outbound_resumo falhou", {
      workspaceId,
      message: sem.error?.message ?? com.error?.message,
    });
    return null;
  }

  const visao = montarVisao((sem.data ?? []) as RpcRow[]);
  const visaoCom = montarVisao((com.data ?? []) as RpcRow[]);
  const testes = visaoCom.base - visao.base;
  return { ...visao, comTestes: testes > 0 ? visaoCom : null, testes };
}
