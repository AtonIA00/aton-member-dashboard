import "server-only";
import { getDashboardData } from "@/lib/leads";
import {
  parsePeriodKey,
  previousRange,
  resolvePeriod,
  type PeriodKey,
} from "@/lib/period";
import { classify } from "@/lib/classify";

// Tools expostas pro TON via OpenAI tool calling. Cada tool:
// - Recebe workspace_id server-side (do HMAC validado) + params do modelo
// - Reusa lib/leads.ts pra agregação (sem reinventar)
// - Retorna JSON serializável
// - Mascara PII quando relevante (get_recent_leads)

export type ToolName =
  | "get_kpis"
  | "get_funnel"
  | "get_campaign_breakdown"
  | "get_ad_performance"
  | "get_stage_distribution"
  | "get_recent_leads"
  | "get_monthly_evolution"
  | "compare_periods";

// Schema OpenAI tool definitions — passado no chat.completions API.
export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "get_kpis",
      description:
        "Retorna os principais KPIs do workspace em um período. Use sempre antes de responder perguntas de 'como vai', 'panorama', 'resumo'. Inclui deltas vs período anterior quando disponível.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["all", "today", "yesterday", "this_month", "last_month", "7d", "30d", "90d"],
            description: "Período do recorte. Default 30d se omitido.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_funnel",
      description:
        "Retorna a distribuição de leads pelas 5 etapas canônicas do funil (Novo / Em conversa / Agendado+ / Descartado / Outros) no período.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["all", "today", "yesterday", "this_month", "last_month", "7d", "30d", "90d"],
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_campaign_breakdown",
      description:
        "Retorna top N campanhas por volume de leads no período, com % MQL e % Agendamento. Use pra entender qual campanha está performando melhor.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["all", "today", "yesterday", "this_month", "last_month", "7d", "30d", "90d"],
          },
          limit: { type: "integer", description: "Número de campanhas a retornar. Default 10.", minimum: 1, maximum: 50 },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_ad_performance",
      description:
        "Retorna performance por anúncio (Meta Ads id_anuncio): leads totais, agendados, % de cada métrica. Top N ordenado por total. Use pra identificar criativos vencedores.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["all", "today", "yesterday", "this_month", "last_month", "7d", "30d", "90d"],
          },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_stage_distribution",
      description:
        "Retorna count + % por etapa do funil agrupada na taxonomia canônica (Novo / Em conversa / Agendado+ / Descartado / Outros).",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["all", "today", "yesterday", "this_month", "last_month", "7d", "30d", "90d"],
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recent_leads",
      description:
        "Retorna sample de leads recentes do workspace. PII mascarada (telefone últimos 4 dígitos, só first name). Use parcimoniosamente pra ilustrar casos concretos — não pra listagem em volume.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Default 10." },
          etapa: {
            type: "string",
            enum: ["novo", "em_conversa", "agendado_mais", "descartado", "outros"],
            description: "Filtra por etapa agrupada. Opcional.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_monthly_evolution",
      description:
        "Retorna evolução mensal dos últimos 12 meses com 4 séries: total, mqlSim, agendado, interacao (%). Use pra perguntas de trajetória, tendência, sazonalidade.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_periods",
      description:
        "Compara KPIs entre o período atual e o período anterior automaticamente derivado (today→ontem, this_month→mesmos dias do mês passado, etc). Retorna deltas explícitos com classificação semântica (positive/negative/neutral).",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "yesterday", "this_month", "last_month", "7d", "30d", "90d"],
            description: "Período corrente a comparar. NÃO usar 'all' (sem referência).",
          },
        },
        required: ["period"],
      },
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Execução das tools

type ToolArgs = Record<string, unknown>;

function normalizePeriod(args: ToolArgs, fallback: PeriodKey = "30d"): PeriodKey {
  const p = args.period;
  if (typeof p === "string" && p.length > 0) return parsePeriodKey(p);
  return fallback;
}

function maskPhone(ddd: string | null, tel: string | null): string {
  const d = (ddd ?? "").trim();
  const t = (tel ?? "").trim();
  if (!t) return "—";
  // Mantém DDD + 3 primeiros dígitos, mascara meio, mostra últimos 4.
  const onlyDigits = t.replace(/\D/g, "");
  if (onlyDigits.length <= 4) return "•••• " + onlyDigits;
  const last4 = onlyDigits.slice(-4);
  const ddCore = d || onlyDigits.slice(0, 2);
  return `(${ddCore}) •••• ${last4}`;
}

function firstName(full: string | null): string {
  const v = (full ?? "").trim();
  if (!v) return "—";
  return v.split(/\s+/)[0];
}

export async function executeTool(
  toolName: string,
  args: ToolArgs,
  workspaceId: string,
): Promise<unknown> {
  switch (toolName) {
    case "get_kpis": {
      const period = normalizePeriod(args);
      const range = resolvePeriod(period);
      const data = await getDashboardData(workspaceId, range, {}, period);
      return {
        period,
        range,
        kpis: data.kpis,
        previous_range: data.previousRange,
        kpis_previous: data.kpisPrevious,
        deltas: data.deltas
          ? Object.fromEntries(
              Object.entries(data.deltas).map(([k, v]) => [
                k,
                { direction: v.direction, classification: v.classification, formatted: v.formatted, value: v.value, valuePrevious: v.valuePrevious },
              ]),
            )
          : null,
      };
    }
    case "get_funnel": {
      const period = normalizePeriod(args);
      const range = resolvePeriod(period);
      const data = await getDashboardData(workspaceId, range, {}, period);
      return { period, funnel: data.funnel, total: data.kpis.total };
    }
    case "get_campaign_breakdown": {
      const period = normalizePeriod(args);
      const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, args.limit)) : 10;
      const range = resolvePeriod(period);
      const data = await getDashboardData(workspaceId, range, {}, period);

      // Agrupa direto dos leads filtrados — pra ter % MQL e % Agendamento.
      const bucket = new Map<string, { total: number; mqlSim: number; agendados: number }>();
      for (const l of data.leads) {
        const name = l.nome_campanha?.trim() || "Sem campanha";
        const b = bucket.get(name) ?? { total: 0, mqlSim: 0, agendados: 0 };
        b.total++;
        if ((l.mql ?? "").toLowerCase().trim() === "sim") b.mqlSim++;
        if (classify(l.etapa_funil) === "Agendado+") b.agendados++;
        bucket.set(name, b);
      }
      const rows = [...bucket.entries()]
        .map(([nome, b]) => ({
          campanha: nome,
          total: b.total,
          mql_sim: b.mqlSim,
          agendado_mais: b.agendados,
          pct_mql: b.total > 0 ? +(b.mqlSim / b.total * 100).toFixed(1) : 0,
          pct_agendamento: b.total > 0 ? +(b.agendados / b.total * 100).toFixed(1) : 0,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);
      return { period, campaigns: rows };
    }
    case "get_ad_performance": {
      const period = normalizePeriod(args);
      const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, args.limit)) : 10;
      const range = resolvePeriod(period);
      const data = await getDashboardData(workspaceId, range, {}, period);
      const rows = data.adsPerformance.slice(0, limit).map((r) => ({
        rank: r.rank,
        id_anuncio: r.idAnuncio,
        total: r.total,
        agendados: r.agendados,
        pct_agendamento: +(r.pctAgendamento * 100).toFixed(1),
        pct_mql: +(r.pctMql * 100).toFixed(1),
        pct_interacao: +(r.pctInteracao * 100).toFixed(1),
        is_unknown_id: r.isUnknownId,
      }));
      return { period, ads: rows };
    }
    case "get_stage_distribution": {
      const period = normalizePeriod(args);
      const range = resolvePeriod(period);
      const data = await getDashboardData(workspaceId, range, {}, period);
      const stages = data.charts.stageDistribution.map((s) => ({
        name: s.name,
        value: s.value,
        pct: data.kpis.total > 0 ? +((s.value / data.kpis.total) * 100).toFixed(1) : 0,
      }));
      return { period, total: data.kpis.total, stages };
    }
    case "get_recent_leads": {
      const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, args.limit)) : 10;
      const etapaFilter = typeof args.etapa === "string" ? args.etapa : null;
      // Recorte all-time pra recents, ordenado por data desc (lib/leads já ordena).
      const range = resolvePeriod("all");
      const data = await getDashboardData(workspaceId, range, {}, "all");
      const grupoMap: Record<string, string> = {
        novo: "Novo",
        em_conversa: "Em conversa",
        agendado_mais: "Agendado+",
        descartado: "Descartado",
        outros: "Outros",
      };
      const wanted = etapaFilter ? grupoMap[etapaFilter] : null;
      const filtered = wanted
        ? data.leads.filter((l) => classify(l.etapa_funil) === wanted)
        : data.leads;
      return {
        leads: filtered.slice(0, limit).map((l) => ({
          data: l.data,
          first_name: firstName(l.nome_lead),
          telefone_mascarado: maskPhone(l.ddd_lead, l.telefone),
          etapa_grupo: classify(l.etapa_funil),
          etapa_raw: l.etapa_funil,
          mql: l.mql,
          nome_campanha: l.nome_campanha,
          id_anuncio: l.id_anuncio,
          canal: l.canal_campanha,
          resumo_conversa: l.resumo_conversa,
        })),
      };
    }
    case "get_monthly_evolution": {
      // Reusa o build do M8 (12 meses sem filtros). Passa range="all" só
      // por compatibilidade da API; o monthlyEvolution interno ignora.
      const range = resolvePeriod("all");
      const data = await getDashboardData(workspaceId, range, {}, "all");
      return { monthly_evolution: data.charts.monthlyEvolution };
    }
    case "compare_periods": {
      const period = normalizePeriod(args, "30d");
      if (period === "all") {
        return { error: "Comparativo não disponível em 'Todo período'. Escolha outro." };
      }
      const range = resolvePeriod(period);
      const data = await getDashboardData(workspaceId, range, {}, period);
      const prev = previousRange(range, period);
      return {
        period,
        current_range: range,
        previous_range: prev,
        kpis_current: data.kpis,
        kpis_previous: data.kpisPrevious,
        deltas: data.deltas,
      };
    }
    default:
      return { error: `Tool desconhecida: ${toolName}` };
  }
}
