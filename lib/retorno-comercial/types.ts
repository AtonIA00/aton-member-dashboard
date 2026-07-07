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
  /** Lista dos que aguardam, pro card clicável. */
  lista_aguardando: LeadAguardando[];
};
