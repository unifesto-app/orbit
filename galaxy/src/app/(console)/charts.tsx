"use client";

import type { Tally } from "@orbit/contract";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import s from "./charts.module.css";

// Prelaunch's charts (owner, 18 Nov 2026: "need all available useful analytics", "use chart library"): Recharts, one
// series each, so one colour: Sage. Colours, type and the tooltip come from Galaxy's tokens through charts.module.css
// (.chart), since SVG attributes can't read CSS variables; nothing here names a colour.

const tooltip = {
  contentStyle: {
    background: "var(--color-background-container-content)",
    border: "1px solid var(--color-border-divider-default)",
    borderRadius: 8,
    color: "var(--color-text-body-default)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--color-text-heading-default)", fontWeight: 600 },
  itemStyle: { color: "var(--color-text-body-default)", padding: 0 },
  separator: ": ",
  isAnimationActive: false,
};

// "18 Nov" from "2026-11-18".
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
// "12 am", "3 pm".
const hourName = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

// A count a day, the last 30 days: joins on Prelaunch, visitors on Website.
export function Days({ days, label = "Joins a day, last 30 days", series = "Joined" }: { days: { day: string; count: number }[]; label?: string; series?: string }) {
  const data = days.map((d) => ({ name: shortDay(d.day), count: d.count }));
  return <Columns data={data} label={label} series={series} height={220} interval="preserveStartEnd" />;
}

// Joins by hour of the day, India's time: when to post.
export function Hours({ hours }: { hours: number[] }) {
  const data = hours.map((count, h) => ({ name: hourName(h), count }));
  return <Columns data={data} label="Joins by hour of day, India time" series="Joined" height={200} interval={2} />;
}

// Ordered bins (ages): columns, in the order given.
export function Bins({ data, label }: { data: Tally; label: string }) {
  return <Columns data={data} label={label} series="People" height={200} interval={0} />;
}

function Columns({ data, label, series, height, interval }: { data: Tally; label: string; series: string; height: number; interval: number | "preserveStartEnd" }) {
  return (
    <figure className={s.chart} style={{ height }} aria-label={label}>
      <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -24 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} interval={interval} minTickGap={8} fontSize={11} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={48} />
        <Tooltip {...tooltip} formatter={(v) => [v, series]} />
        <Bar dataKey="count" name={series} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
      </ResponsiveContainer>
      {/* The values as text for screen readers: columns show them only on hover. */}
      <table className={s.srOnly}>
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}>
              <th scope="row">{d.name}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// A ranked list as horizontal bars, in the order given, with the count (and a share of `of`) at each bar's end, or a
// row's own `value`. Long names are cut, whole on hover; `wide` gives names more room (job titles). The space after the
// bars grows with the longest value, so "4 · 0 applied (0%)" stays on one line.
export function Ranked({ data, of, label, series = "People", wide = false }: { data: (Tally[number] & { value?: string })[]; of?: number; label: string; series?: string; wide?: boolean }) {
  if (!data.length) return <p className={s.empty}>Nothing yet.</p>;
  const rows = data.map((d) => ({ ...d, value: d.value ?? (of ? `${d.count} · ${Math.round((d.count / of) * 100)}%` : String(d.count)) }));
  const right = Math.max(72, Math.max(...rows.map((r) => r.value.length)) * 7 + 8); // about 7px a character at 12px
  return (
    <figure className={s.chart} style={{ height: rows.length * 34 + 8 }} aria-label={label}>
      <ResponsiveContainer>
      <BarChart layout="vertical" data={rows} margin={{ top: 0, right, bottom: 0, left: 0 }} barCategoryGap={8} accessibilityLayer>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={wide ? 256 : 176} tickLine={false} axisLine={false} fontSize={12} tick={<Name max={wide ? 36 : 22} />} />
        <Tooltip {...tooltip} formatter={(_v, _n, p) => [p.payload.value, series]} />
        <Bar dataKey="count" name={series} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          <LabelList dataKey="value" position="right" />
        </Bar>
      </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

// A category name on the left of a bar, cut to fit, whole in its title.
function Name(props: { x?: number | string; y?: number | string; payload?: { value: string }; max?: number }) {
  const name = props.payload?.value ?? "";
  const max = props.max ?? 22;
  const cut = name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
  return (
    <text x={Number(props.x) - 8} y={props.y} dy={4} textAnchor="end" className={s.tick}>
      <title>{name}</title>
      {cut}
    </text>
  );
}
