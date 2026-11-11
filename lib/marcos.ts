import { classify, posAtendimento } from "./classify";

// Marcos do funil até a venda (11/11/2026). A etapa_funil é um campo só e é
// sobrescrita: o lead que fez a reunião e depois foi para "Não se interessou"
// sumia da reunião. Um gatilho no CRM (aton-core PR 708) grava a data de cada
// marco na linha do lead, e essas datas nunca são apagadas. Sem data (lead
// antigo, workspace sem o gatilho), vale a etapa atual, como antes.
//
// Só o funil até a venda (wa_member_dashboard_access.funil_reuniao) lê as
// datas. Nos outros assinantes o Convertido segue a etapa atual: com o
// gatilho valendo para todos, quem agendou e depois desistiu passaria a
// contar como convertido, e isso muda o número que eles já acompanham.

export type MarcosLead = {
  etapa_funil: string | null;
  agendado_em?: string | null;
  reuniao_em?: string | null;
  venda_em?: string | null;
};

export type Marco = "agendado" | "reuniao" | "venda";

/** O lead chegou ao marco. Cumulativo: quem vendeu teve reunião, quem teve
 *  reunião agendou. comDatas=false é a leitura antiga, só pela etapa atual. */
export function chegouAo(l: MarcosLead, marco: Marco, comDatas: boolean): boolean {
  const pos = posAtendimento(l.etapa_funil);
  const venda = pos === "venda" || (comDatas && !!l.venda_em);
  if (marco === "venda") return venda;
  const reuniao = venda || pos !== null || (comDatas && !!l.reuniao_em);
  if (marco === "reuniao") return reuniao;
  return reuniao || classify(l.etapa_funil) === "Agendado+" || (comDatas && !!l.agendado_em);
}

// ── Perdas ───────────────────────────────────────────────────────────────
// perda_etapa e perda_motivo vêm do gatilho e do Core. Rótulos para o
// assinante; valor desconhecido aparece cru, para não sumir com o lead.

const ETAPA_PERDA: Record<string, { ordem: number; rotulo: string }> = {
  pre_agendamento: { ordem: 0, rotulo: "Antes de agendar" },
  agendado: { ordem: 1, rotulo: "Agendou e desistiu antes da reunião" },
  confirmado: { ordem: 2, rotulo: "Confirmou e desistiu antes da reunião" },
  reuniao: { ordem: 3, rotulo: "Faltou à reunião e não remarcou" },
  pos_reuniao: { ordem: 4, rotulo: "Depois da reunião" },
};

const MOTIVO_PERDA: Record<string, string> = {
  desistiu: "Desistiu",
  pediu_parar: "Pediu para parar",
  cadencia_esgotada: "Parou de responder",
  ja_comprou: "Já comprou",
  sem_condicao: "Sem condição",
  nao_gostou: "Não gostou",
  mudou_planos: "Mudou de planos",
  outro: "Outro motivo",
};

export type PerdaEtapa = {
  etapa: string;
  rotulo: string;
  total: number;
  motivos: { rotulo: string; total: number }[];
};

export type PerdasLead = MarcosLead & {
  perdido_em?: string | null;
  perda_etapa?: string | null;
  perda_motivo?: string | null;
};

function rotuloMotivo(m: string | null | undefined): string {
  const v = (m ?? "").trim();
  if (!v) return "Sem motivo registrado";
  // Pós-visita chega como "sem_interesse:<motivo>".
  const chave = v.startsWith("sem_interesse:") ? v.slice("sem_interesse:".length) : v;
  return MOTIVO_PERDA[chave] ?? chave;
}

/** Perdas do recorte por etapa e motivo, na ordem do funil. */
export function resumirPerdas(leads: PerdasLead[]): PerdaEtapa[] {
  const porEtapa = new Map<string, Map<string, number>>();
  for (const l of leads) {
    if (!l.perdido_em) continue;
    const etapa = (l.perda_etapa ?? "").trim() || "sem_etapa";
    const motivos = porEtapa.get(etapa) ?? new Map<string, number>();
    const m = rotuloMotivo(l.perda_motivo);
    motivos.set(m, (motivos.get(m) ?? 0) + 1);
    porEtapa.set(etapa, motivos);
  }
  return [...porEtapa.entries()]
    .map(([etapa, motivos]) => ({
      etapa,
      rotulo: ETAPA_PERDA[etapa]?.rotulo ?? (etapa === "sem_etapa" ? "Etapa não registrada" : etapa),
      total: [...motivos.values()].reduce((a, b) => a + b, 0),
      motivos: [...motivos.entries()]
        .map(([rotulo, total]) => ({ rotulo, total }))
        .sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => (ETAPA_PERDA[a.etapa]?.ordem ?? 9) - (ETAPA_PERDA[b.etapa]?.ordem ?? 9));
}
