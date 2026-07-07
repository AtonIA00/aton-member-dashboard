// Régua de referência — hora útil + análise de retorno (handoff §4).
//
// ⚠️ NÃO usado no caminho de render do v1. No v1 (Opção 1) o Aton Core
// computa a métrica e devolve os agregados prontos (ver source.ts); o dash
// só exibe. Este módulo existe por dois motivos:
//   1. Paridade documentada: deixa a régua explícita no repo do dash, pra
//      auditar que Core e dash usam as MESMAS definições (SLA 30min úteis,
//      Seg–Sáb 08–18 America/São Paulo, sem DST → UTC-3 fixo).
//   2. Base pronta pro adapter LOCAL futuro (Opção 3): se um dia o ingester
//      gravar as mensagens out/agent no banco, o dash poderá computar nativo
//      reusando estas funções — sem reescrever a régua.
//
// Se mudar SLA ou horário, mude AQUI e no Core juntos (handoff §7).

const BIZ_OPEN_MIN = 8 * 60;
const BIZ_CLOSE_MIN = 18 * 60;
const SP_OFFSET_SEC = -3 * 3600;

/**
 * Minutos de HORA ÚTIL (Seg–Sáb 08–18 SP) entre dois instantes (unix segundos).
 * Desloca p/ UTC-3 e lê campos UTC (BR sem DST). Domingo fechado.
 */
export function businessMinutesBetween(startTs: number, endTs: number): number {
  if (!(endTs > startTs)) return 0;
  const s = startTs + SP_OFFSET_SEC;
  const e = endTs + SP_OFFSET_SEC;
  let total = 0;
  for (let d = Math.floor(s / 86400) * 86400; d < e; d += 86400) {
    if (new Date(d * 1000).getUTCDay() === 0) continue; // domingo
    const lo = Math.max(s, d + BIZ_OPEN_MIN * 60);
    const hi = Math.min(e, d + BIZ_CLOSE_MIN * 60);
    if (hi > lo) total += hi - lo;
  }
  return Math.round(total / 60);
}

export type MsgRole = "lead" | "bot" | "agent";
export type ConversaMsg = { role: MsgRole; ts: number };

export type RetornoAnalise =
  | { status: "aguardando" }
  | { status: "retornado"; esperaUtilMin?: number; dentroSla?: boolean };

/**
 * Por lead Agendado, dada a lista de mensagens em ordem cronológica.
 * `type=agent` (atendente humano) define retorno. Tempo = 1ª msg do
 * atendente − última msg do lead antes dela, em hora útil. Atendente
 * proativo (sem msg do lead antes) conta como retornado, sem tempo.
 */
export function analisaRetorno(msgs: ConversaMsg[], slaMin = 30): RetornoAnalise {
  const iAgent = msgs.findIndex((m) => m.role === "agent");
  if (iAgent < 0) return { status: "aguardando" };
  const agentTs = msgs[iAgent].ts;
  let leadTs = 0;
  for (let k = iAgent - 1; k >= 0; k--) {
    if (msgs[k].role === "lead") {
      leadTs = msgs[k].ts;
      break;
    }
  }
  if (!leadTs || agentTs <= leadTs) return { status: "retornado" }; // proativo
  const esperaUtilMin = businessMinutesBetween(leadTs, agentTs);
  return { status: "retornado", esperaUtilMin, dentroSla: esperaUtilMin <= slaMin };
}
