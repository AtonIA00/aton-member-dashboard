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

const HEIGHT = 250;

const AXIS_STYLE = {
  fontSize: 11,
  fill: "#8899AA",
  fontFamily: "var(--font-geist-sans)",
};

export function StageDistributionChart({ data }: { data: StageDistributionPoint[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
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
            data={data}
            margin={{ top: 8, right: 32, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke="rgba(0,229,255,0.06)" horizontal={false} />
            <XAxis
              type="number"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: "rgba(0,229,255,0.10)" }}
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
              content={<AtonTooltip showPercent />}
              cursor={{ fill: "rgba(0,229,255,0.06)" }}
            />
            <Bar
              dataKey="value"
              name="Leads"
              radius={[0, 4, 4, 0]}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} fillOpacity={0.85} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v) =>
                  typeof v === "number" ? v.toLocaleString("pt-BR") : String(v ?? "")
                }
                style={{ fill: "#E8EDF2", fontSize: 11, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
