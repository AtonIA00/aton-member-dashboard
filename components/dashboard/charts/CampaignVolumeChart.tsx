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
import type { CampaignVolumePoint } from "@/lib/charts";
import { ChartCard } from "./ChartCard";
import { EmptyChart } from "./EmptyChart";
import { AtonTooltip } from "./tooltip";
import { CHART_AXIS, CHART_COLORS } from "@/lib/chart-palette";
import { useTheme } from "@/lib/use-theme";

const HEIGHT = 320;

const AXIS_STYLE = {
  fontSize: 11,
  fill: CHART_AXIS.text,
  fontFamily: "var(--font-geist-sans)",
};

export function CampaignVolumeChart({ data }: { data: CampaignVolumePoint[] }) {
  const theme = useTheme();
  // Cor do label que fica do lado de fora da barra (sobre o bg do card).
  // Precisa ter contraste tanto em light quanto em dark.
  const labelFill = theme === "dark" ? "#f4f6fb" : "#0b1220";
  // Decisão: esconder (placeholder) quando 1 campanha só — o KPI de
  // "Campanhas ativas" já comunica isso e barra única polui visualmente.
  if (data.length <= 1) {
    return (
      <ChartCard title="Volume por Campanha">
        <EmptyChart
          message={
            data.length === 0
              ? "Nenhuma campanha encontrada no recorte."
              : "Disponível quando houver mais de uma campanha ativa."
          }
          height={HEIGHT}
        />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Volume por Campanha"
      subtitle={`Top ${data.length}`}
    >
      <div style={{ width: "100%", height: HEIGHT }}>
        <ResponsiveContainer>
          <BarChart
            layout="vertical"
            data={data}
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
              tick={{ ...AXIS_STYLE, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={170}
            />
            <Tooltip
              content={
                <AtonTooltip
                  // Tooltip mostra o nome completo (que pode ter sido truncado no eixo).
                  labelFormatter={(label) => {
                    const point = data.find((d) => d.name === label);
                    return point?.fullName ?? String(label);
                  }}
                />
              }
              cursor={{ fill: "rgba(0,87,255,0.08)" }}
            />
            <Bar
              dataKey="total"
              name="Leads"
              radius={[0, 4, 4, 0]}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
            >
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={CHART_COLORS.primary}
                  fillOpacity={0.95 - i * 0.06}
                />
              ))}
              <LabelList
                dataKey="total"
                position="right"
                style={{ fill: labelFill, fontSize: 11, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
