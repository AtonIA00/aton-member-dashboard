"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "@/components/dashboard/charts/ChartCard";
import { EmptyChart } from "@/components/dashboard/charts/EmptyChart";
import { AtonTooltip } from "@/components/dashboard/charts/tooltip";
import { CHART_AXIS, CHART_COLORS } from "@/lib/chart-palette";
import { useTheme } from "@/lib/use-theme";
import type {
  CanalSlice,
  CoordRankRow,
  DailyPoint,
  FollowupPoint,
  StatusSlice,
} from "@/lib/trisul";

const AXIS_STYLE = {
  fontSize: 11,
  fill: CHART_AXIS.text,
  fontFamily: "var(--font-geist-sans)",
};

function ddmm(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

// ── Volume diário: disparos × respostas ──────────────────────────────────────
export function TrisulDailyChart({ data }: { data: DailyPoint[] }) {
  return (
    <ChartCard title="Volume por dia" subtitle={data.length ? `${data.length} dia${data.length === 1 ? "" : "s"}` : undefined}>
      {data.length === 0 ? (
        <EmptyChart message="Sem disparos no período." height={300} />
      ) : (
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="dia" tickFormatter={ddmm} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: CHART_AXIS.axis }} minTickGap={20} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: CHART_AXIS.axis }} allowDecimals={false} width={42} />
              <Tooltip content={<AtonTooltip labelFormatter={(l) => ddmm(String(l))} />} cursor={{ stroke: CHART_AXIS.cursor, strokeWidth: 1 }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={8} />
              <Line type="monotone" dataKey="disparos" name="Disparos" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 2.5, fill: CHART_COLORS.primary }} activeDot={{ r: 5 }} isAnimationActive animationDuration={400} />
              <Line type="monotone" dataKey="respostas" name="Respostas" stroke={CHART_COLORS.success} strokeWidth={2} dot={{ r: 2.5, fill: CHART_COLORS.success }} activeDot={{ r: 5 }} isAnimationActive animationDuration={400} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

// ── Consolidado por status (donut) ───────────────────────────────────────────
export function TrisulStatusChart({ data }: { data: StatusSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartCard title="Consolidado por status" subtitle={total > 0 ? `${total.toLocaleString("pt-BR")} atendimentos` : undefined}>
      {total === 0 ? (
        <EmptyChart message="Sem atendimentos com desfecho no período." height={250} />
      ) : (
        <div style={{ width: "100%", height: 250 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="58%" outerRadius="85%" paddingAngle={1} strokeWidth={0} isAnimationActive animationDuration={400}>
                {data.filter((d) => d.value > 0).map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Pie>
              <Tooltip content={<AtonTooltip showPercent percentTotal={total} />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

// ── Efetividade do follow-up ──────────────────────────────────────────────────
export function TrisulFollowupChart({ data }: { data: FollowupPoint[] }) {
  const theme = useTheme();
  const labelFill = theme === "dark" ? "#f4f6fb" : "#0b1220";
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartCard title="Efetividade do follow-up" subtitle="qual toque trouxe a resposta">
      {total === 0 ? (
        <EmptyChart message="Sem respostas no período." height={250} />
      ) : (
        <div style={{ width: "100%", height: 250 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: CHART_AXIS.axis }} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: CHART_AXIS.axis }} allowDecimals={false} domain={[0, "dataMax"]} width={44} />
              <Tooltip content={<AtonTooltip />} cursor={{ fill: "rgba(0,87,255,0.08)" }} />
              <Bar dataKey="value" name="Respostas" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={400}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS.primary} fillOpacity={0.95 - i * 0.12} />
                ))}
                <LabelList dataKey="value" position="top" style={{ fill: labelFill, fontSize: 11, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

// ── Canal do coordenador (donut) ─────────────────────────────────────────────
export function TrisulCanalChart({ data }: { data: CanalSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartCard title="Canal do coordenador" subtitle={total > 0 ? `${total.toLocaleString("pt-BR")} citações` : undefined}>
      {total === 0 ? (
        <EmptyChart message="Sem contato com coordenador registrado." height={250} />
      ) : (
        <div style={{ width: "100%", height: 250 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="58%" outerRadius="85%" paddingAngle={1} strokeWidth={0} isAnimationActive animationDuration={400}>
                {data.filter((d) => d.value > 0).map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Pie>
              <Tooltip content={<AtonTooltip showPercent percentTotal={total} />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

// ── Ranking por coordenador (barras horizontais) ─────────────────────────────
export function TrisulCoordRanking({ data }: { data: CoordRankRow[] }) {
  const theme = useTheme();
  const labelFill = theme === "dark" ? "#f4f6fb" : "#0b1220";
  return (
    <ChartCard title="Ranking por coordenador" subtitle={data.length ? `${data.length}` : undefined}>
      {data.length === 0 ? (
        <EmptyChart message="Sem dados por coordenador no período." height={300} />
      ) : (
        <div style={{ width: "100%", height: Math.max(300, data.length * 40) }}>
          <ResponsiveContainer>
            <BarChart layout="vertical" data={data} margin={{ top: 8, right: 40, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} horizontal={false} />
              <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: CHART_AXIS.axis }} allowDecimals={false} />
              <YAxis type="category" dataKey="coordenador" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={150} />
              <Tooltip
                content={
                  <AtonTooltip
                    labelFormatter={(label) => {
                      const r = data.find((d) => d.coordenador === label);
                      if (!r) return String(label);
                      return `${label} · ${r.respostas} resp · conv ${(r.conversao * 100).toFixed(0)}%`;
                    }}
                  />
                }
                cursor={{ fill: "rgba(0,87,255,0.08)" }}
              />
              <Bar dataKey="disparos" name="Disparos" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={400}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS.primary} fillOpacity={0.95 - i * 0.05} />
                ))}
                <LabelList dataKey="disparos" position="right" style={{ fill: labelFill, fontSize: 11, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
