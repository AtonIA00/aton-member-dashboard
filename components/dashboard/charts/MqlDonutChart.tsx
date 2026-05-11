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
        <EmptyChart message="Sem dados pra compor a qualificação MQL." height={HEIGHT} />
      </ChartCard>
    );
  }

  // Detecta workspace 100% sem MQL pra mostrar microcopy contextual.
  const semMql = data.find((d) => d.name === "Sem MQL");
  const isAllSemMql = semMql && semMql.value === total;

  return (
    <ChartCard
      title="MQL — Qualificação"
      subtitle={`${total.toLocaleString("pt-BR")} leads`}
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
            <Tooltip content={<AtonTooltip showPercent />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {isAllSemMql && (
        <div className="mt-2 rounded border border-[color:var(--border)] bg-white/[0.02] px-3 py-2 text-[11px] text-[color:var(--muted-foreground)]">
          Seu agente ainda não marcou MQL nesses leads. Fale com a Aton se
          quiser orientação pra ativar a qualificação automática.
        </div>
      )}
    </ChartCard>
  );
}
