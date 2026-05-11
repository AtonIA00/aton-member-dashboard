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
import type { DailyVolumePoint } from "@/lib/charts";
import { ChartCard } from "./ChartCard";
import { EmptyChart } from "./EmptyChart";
import { AtonTooltip } from "./tooltip";

const HEIGHT = 320;

const AXIS_STYLE = {
  fontSize: 11,
  fill: "#8899AA",
  fontFamily: "var(--font-geist-sans)",
};

function formatDDMM(iso: string): string {
  // Espera "YYYY-MM-DD" — produzimos com construção UTC em lib/charts.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}`;
}

export function DailyVolumeChart({ data }: { data: DailyVolumePoint[] }) {
  const totalLeads = data.reduce((s, p) => s + p.total, 0);

  return (
    <ChartCard
      title="Volume diário"
      subtitle={data.length > 0 ? `${data.length} dia${data.length === 1 ? "" : "s"}` : undefined}
    >
      {data.length === 0 ? (
        <EmptyChart message="Sem dados pra montar a série temporal." height={HEIGHT} />
      ) : (
        <div style={{ width: "100%", height: HEIGHT }}>
          <ResponsiveContainer>
            <LineChart
              data={data}
              margin={{ top: 8, right: 16, bottom: 0, left: -20 }}
            >
              <CartesianGrid stroke="rgba(0,229,255,0.06)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDDMM}
                tick={AXIS_STYLE}
                tickLine={false}
                axisLine={{ stroke: "rgba(0,229,255,0.10)" }}
                minTickGap={20}
              />
              <YAxis
                tick={AXIS_STYLE}
                tickLine={false}
                axisLine={{ stroke: "rgba(0,229,255,0.10)" }}
                allowDecimals={false}
                width={42}
              />
              <Tooltip
                content={
                  <AtonTooltip
                    labelFormatter={(l) => formatDDMM(String(l))}
                  />
                }
                cursor={{ stroke: "rgba(0,229,255,0.18)", strokeWidth: 1 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                iconType="circle"
                iconSize={8}
              />
              <Line
                type="monotone"
                dataKey="total"
                name="Total"
                stroke="#00E5FF"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#00E5FF" }}
                activeDot={{ r: 5 }}
                isAnimationActive
                animationDuration={400}
                animationEasing="ease-out"
              />
              <Line
                type="monotone"
                dataKey="mql_sim"
                name="MQL Sim"
                stroke="#69F0AE"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#69F0AE" }}
                activeDot={{ r: 5 }}
                isAnimationActive
                animationDuration={400}
                animationEasing="ease-out"
              />
              <Line
                type="monotone"
                dataKey="agendado_plus"
                name="Agendado+"
                stroke="#B388FF"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#B388FF" }}
                activeDot={{ r: 5 }}
                isAnimationActive
                animationDuration={400}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
          {totalLeads > 0 && (
            <div className="mt-2 text-right text-[11px] text-[color:var(--muted-foreground)]">
              {totalLeads.toLocaleString("pt-BR")} leads no período
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}
