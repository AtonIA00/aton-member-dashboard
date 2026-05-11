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

const HEIGHT = 320;

const AXIS_STYLE = {
  fontSize: 11,
  fill: "#8899AA",
  fontFamily: "var(--font-geist-sans)",
};

export function CampaignVolumeChart({ data }: { data: CampaignVolumePoint[] }) {
  // Decisão: esconder (placeholder) quando 1 campanha só — o KPI de
  // "Campanhas ativas" já comunica isso e barra única polui visualmente.
  if (data.length <= 1) {
    return (
      <ChartCard title="Volume por Campanha">
        <EmptyChart
          message={
            data.length === 0
              ? "Sem campanhas no período"
              : "Disponível com mais de 1 campanha"
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
              cursor={{ fill: "rgba(0,229,255,0.06)" }}
            />
            <Bar
              dataKey="total"
              name="Leads"
              radius={[0, 4, 4, 0]}
              isAnimationActive
              animationDuration={700}
            >
              {data.map((_, i) => (
                <Cell key={i} fill="#00E5FF" fillOpacity={0.85 - i * 0.04} />
              ))}
              <LabelList
                dataKey="total"
                position="right"
                style={{ fill: "#E8EDF2", fontSize: 11, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
