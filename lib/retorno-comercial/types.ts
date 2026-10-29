// Contrato da seção "Retorno do time comercial" (handoff §0/§4).
//
// O Aton Core computa a régua (SLA 30min úteis, 08–18 Seg–Sáb SP) sobre os
// leads em `Agendado` de uma janela recente e devolve estes agregados +
// a lista acionável de quem ainda aguarda retorno. O dash só EXIBE — não
// recalcula (v1). Manter este shape idêntico ao que o endpoint do Core
// retorna; se o Core mudar, ajustar o parser em source.ts (ponto único).
//
// Arquivo puro (sem "server-only") — importado tanto pelo adapter server
// quanto pela UI client.

export type LeadAguardando = {
  /** Pode vir "" (lead sem nome no CRM) — a UI faz fallback pra telefone. */
  nome: string | null;
  /** Vem com +55 (ex.: "+5527999844698"). A UI formata pra exibição. */
  telefone: string | null;
  campanha: string | null;
  /** String JÁ formatada pelo Core pra exibição, ex.: "23/06, 14:50" (NÃO é ISO).
   *  A UI exibe crua. */
  agendado_em: string | null;
  /** Grupo de passados ao time (chave de GrupoRetorno). Ausente no payload antigo. */
  grupo?: string | null;
  /** Etapa do CRM do lead, como está lá (ex.: "Especialista"). */
  etapa?: string | null;
};

/** Um recorte dos passados ao time (29/10/2026): o card contava só Agendado,
 *  e quem pediu entrada, parcela ou financiamento (Especialista e afins)
 *  ficava fora do retorno. Mesma régua do topo, por grupo. */
export type GrupoRetorno = {
  /** "agendados" | "condicoes" hoje; a UI usa o rótulo, não a chave. */
  chave: string;
  rotulo: string;
  total: number;
  retornados: number;
  aguardando: number;
  nao_localizados: number;
  dentro_sla: number;
  mediana_util_min: number;
};

export type RetornoComercial = {
  /** Janela recente considerada (ex.: 14). Rotulada na UI — v1 NÃO usa os
   *  filtros/período do dash; é um snapshot "de agora". */
  janela_dias: number;
  /** Meta de retorno em minutos de hora útil (ex.: 30). */
  sla_min: number;
  /** Total de leads em Agendado na janela. */
  agendados: number;
  /** Agendados com ≥1 mensagem do atendente (type=agent). */
  retornados: number;
  /** Agendados sem nenhuma msg do atendente — o herói acionável. */
  aguardando: number;
  /** Agendados sem conversa vinculada (gap de dado; fora das taxas). */
  nao_localizados: number;
  /** Retornados dentro do SLA. */
  dentro_sla: number;
  /** Mediana do tempo de retorno (min de hora útil) dos retornados com tempo. */
  mediana_util_min: number;
  /** Lista dos que aguardam, pro card clicável. Com `grupos`, cobre todos os
   *  passados ao time, não só os Agendados. */
  lista_aguardando: LeadAguardando[];
  /** Passados ao time por grupo. Vazio = payload antigo (só Agendado): a UI
   *  cai no layout de um bloco só, pelos campos de topo. */
  grupos: GrupoRetorno[];
};
