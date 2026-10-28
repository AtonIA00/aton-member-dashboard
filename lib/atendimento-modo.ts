import "server-only";
import { classify } from "./classify";
import { atendimentoDoLead, type AtendimentoModo } from "./filters";
import { chaveTelefone, type FunnelStep, type LeadRow } from "./leads";
import { chegouAte, type CvLead } from "./cv-leads";
import { adRow, type MetaAdsForTable } from "./meta-ads-kpi";

// Visão por modo de atendimento (WDS, 28/10/2026). A WDS tem duas entradas:
// fora do horário comercial a Flávia conversa; no horário comercial ela fica
// em silêncio e o lead vai direto ao corretor no CV. Misturar os dois fazia o
// lead do horário comercial contar como "não respondeu" e "sem MQL".
//
// Aqui: quantos chegaram por cada caminho, o que o CV diz dos diretos, o
// funil único até a venda (Chegou → Atendido → No CV → Com corretor → Em
// atendimento → Visita → Venda) e o custo por VISITA de cada anúncio. Custo
// por lead, conversa ou MQL não serve de régua aqui: o que paga a conta é a
// visita.

export type AnuncioVisita = {
  idAnuncio: string;
  nome: string | null;
  thumb: string | null;
  /** Gasto do anúncio no período (Meta). null = sem dado da Meta. */
  gasto: number | null;
  leads: number;
  /** Convertido no CRM (Agendado+) ou com visita no CV. Não depende do CV estar no ar. */
  agendados: number;
  noCv: number;
  visitas: number;
  vendas: number;
  /** gasto ÷ agendados. null = sem agendamento ou sem gasto. */
  custoPorAgendamento: number | null;
  /** gasto ÷ visitas. null = sem visita ou sem gasto: a tela escreve "sem visita". */
  custoPorVisita: number | null;
};

export type AtendimentoResumo = {
  filtro: AtendimentoModo | undefined;
  chegaram: number;
  flavia: number;
  direto: number;
  /** false = o CV não respondeu a tempo: funil para em "Atendido" e o resto some. */
  cvDisponivel: boolean;
  diretoNoCv: number;
  diretoComCorretor: number;
  /** Mediana, em minutos, do envio ao CV até o 1º atendimento do corretor. */
  diretoMinAteCorretor: number | null;
  diretoComTempo: number;
  funil: FunnelStep[];
  porAnuncio: AnuncioVisita[];
  moeda: string | null;
};

function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function montarAtendimento(
  leads: LeadRow[],
  cv: CvLead[] | null,
  metaAds: MetaAdsForTable | null,
  filtro: AtendimentoModo | undefined,
): AtendimentoResumo {
  // Lead do dash → registro do CV. Pelo id do CRM; telefone só de reserva.
  const porId = new Map<number, CvLead>();
  const porTel = new Map<string, CvLead>();
  for (const c of cv ?? []) {
    if (c.lead_id != null) porId.set(c.lead_id, c);
    const t = chaveTelefone(c.telefone);
    if (t && !porTel.has(t)) porTel.set(t, c);
  }
  const doCv = (l: LeadRow) => porId.get(l.id) ?? porTel.get(chaveTelefone(l.telefone) ?? "") ?? null;

  let flavia = 0;
  let direto = 0;
  let atendidos = 0;
  let diretoNoCv = 0;
  let diretoComCorretor = 0;
  const tempos: number[] = [];
  const passo = { no_cv: 0, com_corretor: 0, em_atendimento: 0, visita: 0, venda: 0 };
  const ads = new Map<string, { leads: number; agendados: number; noCv: number; visitas: number; vendas: number }>();

  for (const l of leads) {
    const modo = atendimentoDoLead(l);
    const c = doCv(l);
    // Atendido = respondeu à Flávia (saiu de "Novo Lead") OU chegou ao CV.
    // O CV conta mesmo para lead da Flávia em "Novo Lead": em 28/10 havia 3
    // assim (a etapa no CRM não andou, mas o lead foi entregue), e sem isso
    // "No CV" passava de "Atendido" no funil.
    if (c || (modo === "flavia" && classify(l.etapa_funil) !== "Novo")) atendidos++;
    if (modo === "flavia") {
      flavia++;
    } else {
      direto++;
      if (c) {
        diretoNoCv++;
        if (chegouAte(c, "com_corretor")) diretoComCorretor++;
        if (c.enviado_cv_em && c.primeiro_atendimento_em) {
          const min =
            (new Date(c.primeiro_atendimento_em).getTime() - new Date(c.enviado_cv_em).getTime()) / 60_000;
          if (Number.isFinite(min) && min >= 0) tempos.push(min);
        }
      }
    }
    if (c) {
      for (const k of Object.keys(passo) as (keyof typeof passo)[]) if (chegouAte(c, k)) passo[k]++;
    }
    const ad = (l.id_anuncio ?? "").trim();
    if (ad) {
      const b = ads.get(ad) ?? { leads: 0, agendados: 0, noCv: 0, visitas: 0, vendas: 0 };
      b.leads++;
      // Agendada = a Flávia converteu (CRM em Agendado+) ou o CV já registra
      // visita. Em 28/10 o 1º agendamento da Flávia não aparecia em lugar
      // nenhum desta tabela, porque visita só conta depois de feita.
      if (classify(l.etapa_funil) === "Agendado+" || (c && chegouAte(c, "visita"))) b.agendados++;
      if (c) {
        b.noCv++;
        if (chegouAte(c, "visita")) b.visitas++;
        if (chegouAte(c, "venda")) b.vendas++;
      }
      ads.set(ad, b);
    }
  }

  const total = leads.length;
  const pct = (n: number) => (total > 0 ? n / total : 0);
  const cvDisponivel = cv != null;
  const funil: FunnelStep[] = [
    { label: "Chegou", count: total, pctOfTotal: 1 },
    { label: "Atendido", count: atendidos, pctOfTotal: pct(atendidos) },
    ...(cvDisponivel
      ? [
          { label: "No CV", count: passo.no_cv, pctOfTotal: pct(passo.no_cv) },
          { label: "Com corretor", count: passo.com_corretor, pctOfTotal: pct(passo.com_corretor) },
          { label: "Em atendimento", count: passo.em_atendimento, pctOfTotal: pct(passo.em_atendimento) },
          { label: "Visita", count: passo.visita, pctOfTotal: pct(passo.visita) },
          { label: "Venda", count: passo.venda, pctOfTotal: pct(passo.venda) },
        ]
      : []),
  ];

  const porAnuncio: AnuncioVisita[] = [...ads.entries()].map(([id, b]) => {
    const t = metaAds?.ads[id];
    const m = t ? adRow(t) : null;
    const gasto = m ? m.spend : null;
    return {
      idAnuncio: id,
      nome: m?.adName ?? null,
      thumb: m?.thumbnailUrl ?? null,
      gasto,
      ...b,
      custoPorAgendamento: gasto != null && gasto > 0 && b.agendados > 0 ? gasto / b.agendados : null,
      custoPorVisita: gasto != null && gasto > 0 && b.visitas > 0 ? gasto / b.visitas : null,
    };
  });
  // Quem gastou mais primeiro: é onde a pergunta "isso virou visita?" pesa.
  porAnuncio.sort((a, b) => (b.gasto ?? -1) - (a.gasto ?? -1) || b.leads - a.leads);

  return {
    filtro,
    chegaram: total,
    flavia,
    direto,
    cvDisponivel,
    diretoNoCv,
    diretoComCorretor,
    diretoMinAteCorretor: mediana(tempos),
    diretoComTempo: tempos.length,
    funil,
    porAnuncio,
    moeda: metaAds?.currency ?? null,
  };
}
