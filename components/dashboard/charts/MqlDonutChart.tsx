"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { MqlDonutSlice } from "@/lib/charts";
import { ChartCard } from "./ChartCard";
import { EmptyChart } from "./EmptyChart";
import { AtonTooltip } from "./tooltip";

const HEIGHT = 250;

export function MqlDonutChart({ data }: { data: MqlDonutSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <ChartCard title="MQL — Qualificação">
        <EmptyChart
          message="Nenhum lead com MQL marcado nesse recorte. Fale com a Aton se quiser ativar a qualificação automática."
          height={HEIGHT}
        />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="MQL — Qualificação"
      subtitle={`${total.toLocaleString("pt-BR")} leads avaliados`}
    >
      <div style={{ width: "100%", height: HEIGHT }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="86%"
              paddingAngle={1}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
              strokeWidth={0}
            >
              {data.map((slice, i) => (
                <Cell key={i} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<AtonTooltip showPercent percentTotal={total} />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
