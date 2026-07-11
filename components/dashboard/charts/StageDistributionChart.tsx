"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StageDistributionPoint } from "@/lib/charts";
import { ChartCard } from "./ChartCard";
import { EmptyChart } from "./EmptyChart";
import { AtonTooltip } from "./tooltip";
import { CHART_AXIS } from "@/lib/chart-palette";
import { GRUPO_LABEL } from "@/lib/classify";
import { useTheme } from "@/lib/use-theme";

const HEIGHT = 250;

const AXIS_STYLE = {
  fontSize: 11,
  fill: CHART_AXIS.text,
  fontFamily: "var(--font-geist-sans)",
};

export function StageDistributionChart({ data }: { data: StageDistributionPoint[] }) {
  const theme = useTheme();
  const labelFill = theme === "dark" ? "#f4f6fb" : "#0b1220";
  const total = data.reduce((s, d) => s + d.value, 0);
  // Rótulo de exibição por grupo (ex.: "Agendado+" → "Convertido"). O eixo Y
  // e o tooltip leem `name` direto do dado, então mapeamos aqui — cor e ordem
  // canônica (GRUPO_ORDER em lib/charts.ts) preservadas.
  const display = data.map((d) => ({
    name: GRUPO_LABEL[d.name],
    value: d.value,
    color: d.color,
  }));
  if (total === 0) {
    return (
      <ChartCard title="Distribuição por Etapa">
        <EmptyChart message="Sem dados pra distribuir por etapa do funil." height={HEIGHT} />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Distribuição por Etapa"
      subtitle={`${total.toLocaleString("pt-BR")} leads`}
    >
      <div style={{ width: "100%", height: HEIGHT }}>
        <ResponsiveContainer>
          <BarChart
            layout="vertical"
            data={display}
            margin={{ top: 8, right: 32, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke={CHART_AXIS.grid} horizontal={false} />
            <XAxis
              type="number"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: CHART_AXIS.axis }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={92}
            />
            <Tooltip
              content={<AtonTooltip showPercent percentTotal={total} />}
              cursor={{ fill: "rgba(0,87,255,0.08)" }}
            />
            <Bar
              dataKey="value"
              name="Leads"
              radius={[0, 4, 4, 0]}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
            >
              {display.map((d, i) => (
                <Cell key={i} fill={d.color} fillOpacity={0.92} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v) =>
                  typeof v === "number" ? v.toLocaleString("pt-BR") : String(v ?? "")
                }
                style={{ fill: labelFill, fontSize: 11, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
