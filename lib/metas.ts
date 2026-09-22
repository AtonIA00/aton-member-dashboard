/**
 * Metas de performance, fonte ÚNICA do produto.
 *
 * Antes destes valores existirem aqui, eles estavam duplicados em dois lugares
 * (AdsPerformanceTable e export-ads), só como faixa de cor da tabela de
 * anúncios, e não apareciam em lugar nenhum para o assinante. Os mesmos
 * números eram usados de cabeça em treinamento. Com os KPIs passando a exibir
 * meta, virou obrigatório ter um lugar só: meta que diverge entre a tela e a
 * tabela destrói a confiança no painel inteiro.
 *
 * Valores em PERCENTUAL inteiro (0-100), não em fração. Isso é proposital:
 * as faixas de cor já consomem 0-100, e converter fração para percentual
 * (0.65 * 100 = 65.00000000000001) faria a comparação `>=` falhar justamente
 * em cima do valor exato da meta.
 *
 * ── Calibração, medida em 22/09/2026 ──────────────────────────────────────
 * Janela de 06 a 19/09 (a mesma do relatório Pulso), leads de teste
 * descontados, régua de etapa idêntica à do classify() do produto:
 * 1.485 leads em 16 assinantes com pelo menos 10 leads no período.
 *
 *   | métrica                   | carteira | mediana | p75 inbound |
 *   |---------------------------|----------|---------|-------------|
 *   | interação                 |   62%    |   63%   |     80%     |
 *   | MQL entre quem respondeu  |   40%    |   35%   |     52%     |
 *   | MQL sobre o total         |   26%    |   26%   |     39%     |
 *   | conversão                 |    6%    |    9%   |     15%     |
 *
 * A regra de leitura: `minima` é onde está a mediana da carteira, ou seja, o
 * que um assinante saudável entrega hoje. `ideal` é onde estão os melhores.
 * Não é para a `ideal` ser confortável, e não é para a `minima` ser
 * inatingível.
 *
 * Três coisas que NÃO servem para calibrar, aprendidas nessa medição:
 *  - Lavvi e ERS são operação de reativação OUTBOUND, base própria. O
 *    aproveitamento deles (63% e 7% de MQL entre quem respondeu, os dois
 *    extremos da carteira) não se compara com tráfego frio de inbound.
 *  - Assinante com menos de 10 leads no período. Russi marcou 100% de MQL
 *    entre quem respondeu com 11 leads.
 *  - Volume grande puxa a régua para baixo e é ele que manda: a maior
 *    operação da carteira, 594 leads, para em 73% de interação. Por isso a
 *    meta ideal de interação é 75% e não os 80% do p75.
 */

export type Meta = {
  /** Abaixo disto o número pede ação imediata. Usado só na faixa de cor. */
  piso: number;
  /** O que um assinante saudável entrega. */
  minima: number;
  /** Onde estão os melhores da carteira. */
  ideal: number;
};

export const METAS = {
  interacao: { piso: 50, minima: 65, ideal: 75 },
  /** Aproveitamento da conversa. Métrica nova em 22/09/2026, sem histórico
   *  anterior de faixa de cor, calibrada direto pela medição da carteira:
   *  mediana 35, p75 52. */
  mqlInteragiram: { piso: 20, minima: 35, ideal: 50 },
  /** ATENÇÃO: mais permissiva que a mediana medida (26%). Estes três valores
   *  são a calibração por quartis da tabela de anúncios, que já estava no ar,
   *  e hoje NÃO aparecem como meta em card nenhum (o card de MQL destaca o
   *  aproveitamento da conversa). Mexer aqui repinta a tabela de anúncios de
   *  todos os assinantes, então fica como está até alguém decidir isso de
   *  propósito. */
  mqlTotal: { piso: 10, minima: 20, ideal: 30 },
  conversao: { piso: 4, minima: 9, ideal: 15 },
} as const satisfies Record<string, Meta>;

/** Volume abaixo do qual percentual não significa nada e a meta é escondida.
 *  Com 3 leads, um lead a mais mexe 33 pontos na taxa. */
export const VOLUME_MINIMO = 10;

export type Faixa = "abaixo" | "dentro" | "ideal";

/** Recebe a taxa como FRAÇÃO (0-1), do jeito que os KPIs guardam. */
export function faixaDaMeta(taxa01: number, meta: Meta): Faixa {
  const v = taxa01 * 100;
  if (v >= meta.ideal) return "ideal";
  if (v >= meta.minima) return "dentro";
  return "abaixo";
}

/** Formato que o HeatPill da tabela de anúncios e o export do Excel consomem. */
export function faixasDeCor(meta: Meta): [number, number, number] {
  return [meta.piso, meta.minima, meta.ideal];
}

export function textoDaMeta(meta: Meta): string {
  return `meta mínima ${meta.minima}% · ideal ${meta.ideal}%`;
}
