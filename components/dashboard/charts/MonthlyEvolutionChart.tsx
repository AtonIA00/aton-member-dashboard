"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyEvolutionPoint } from "@/lib/charts";
import { ChartCard } from "./ChartCard";
import { EmptyChart } from "./EmptyChart";
import { AtonTooltip } from "./tooltip";
import { CHART_AXIS, CHART_COLORS } from "@/lib/chart-palette";
import { GRUPO_LABEL } from "@/lib/classify";

const HEIGHT = 320;

const AXIS_STYLE = {
  fontSize: 11,
  fill: CHART_AXIS.text,
  fontFamily: "var(--font-geist-sans)",
};

export function MonthlyEvolutionChart({ data }: { data: MonthlyEvolutionPoint[] }) {
  if (data.length === 0) {
    return (
      <ChartCard
        title="Evolução Mensal"
        subtitle="trajetória do workspace"
      >
        <EmptyChart message="Sem histórico mensal pra mostrar ainda." height={HEIGHT} />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Evolução Mensal"
      subtitle={
        data.length === 12
          ? "últimos 12 meses"
          : `últimos ${data.length} ${data.length === 1 ? "mês" : "meses"}`
      }
      badge="independente de filtros"
    >
      <div style={{ width: "100%", height: HEIGHT }}>
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
          >
            <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: CHART_AXIS.axis }}
              minTickGap={8}
            />
            {/* Eixo esquerdo: counts */}
            <YAxis
              yAxisId="left"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: CHART_AXIS.axis }}
              allowDecimals={false}
              width={42}
            />
            {/* Eixo direito: % */}
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: CHART_AXIS.axis }}
              tickFormatter={(v) => `${v}%`}
              domain={[0, 100]}
              width={42}
            />
            <Tooltip
              content={<AtonTooltip />}
              cursor={{ stroke: CHART_AXIS.cursor, strokeWidth: 1 }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
              iconType="plainline"
              iconSize={14}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="total"
              name="Total"
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              dot={{ r: 3, fill: CHART_COLORS.primary }}
              activeDot={{ r: 5 }}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="mqlSim"
              name="MQL Sim"
              stroke={CHART_COLORS.success}
              strokeWidth={2}
              dot={{ r: 3, fill: CHART_COLORS.success }}
              activeDot={{ r: 5 }}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="agendado"
              name={GRUPO_LABEL["Agendado+"]}
              stroke={CHART_COLORS.secondary}
              strokeWidth={2}
              dot={{ r: 3, fill: CHART_COLORS.secondary }}
              activeDot={{ r: 5 }}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="interacao"
              name="% Interação"
              stroke={CHART_COLORS.warning}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3, fill: CHART_COLORS.warning }}
              activeDot={{ r: 5 }}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
