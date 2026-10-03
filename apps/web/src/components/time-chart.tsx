"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useElementWidth } from "@/hooks/use-element-width";

export type ChartSeries = {
  key: string;
  label: string;
  /** Energy role token, e.g. "solar" -> var(--solar). */
  tone: string;
  values: (number | null)[];
  /** "area" adds a 10% wash under the line; "dash" marks a projection or reference. */
  style?: "line" | "area" | "dash";
};

type Props = {
  title: string;
  x: number[];
  series: ChartSeries[];
  height?: number;
  formatY: (value: number) => string;
  formatX: (t: number) => string;
  /** Tooltip heading; defaults to formatX. */
  formatXLong?: (t: number) => string;
  curve?: "linear" | "step";
  /** Shade everything right of this x (e.g. the forecast part of a day). */
  shadeFrom?: number;
  shadeLabel?: string;
  /** Vertical reference line, e.g. "now". */
  marker?: { x: number; label: string };
  /** Always include zero on the y axis (true for power and money). */
  zero?: boolean;
  emptyText?: string;
};

const PAD = { top: 10, right: 12, bottom: 26, left: 52 };

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(target, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

export function niceTicks(min: number, max: number, target = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    return niceTicks(min - pad, max + pad, target);
  }
  const step = niceStep(max - min, target);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value < max + step * 0.999; value += step) ticks.push(Math.round(value / step) * step);
  return ticks;
}

function pathFor(
  values: (number | null)[],
  xs: number[],
  y: (v: number) => number,
  curve: "linear" | "step",
): string {
  let d = "";
  let open = false;
  values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) {
      open = false;
      return;
    }
    const px = xs[i];
    const py = y(value);
    if (!open) {
      d += `M${px.toFixed(1)},${py.toFixed(1)}`;
      open = true;
    } else if (curve === "step") {
      d += `H${px.toFixed(1)}V${py.toFixed(1)}`;
    } else {
      d += `L${px.toFixed(1)},${py.toFixed(1)}`;
    }
  });
  return d;
}

function areaFor(values: (number | null)[], xs: number[], y: (v: number) => number, base: number): string {
  // One closed polygon per contiguous run of values.
  let d = "";
  let run: number[] = [];
  const flush = () => {
    if (run.length > 1) {
      d += `M${xs[run[0]].toFixed(1)},${base.toFixed(1)}`;
      for (const i of run) d += `L${xs[i].toFixed(1)},${y(values[i] as number).toFixed(1)}`;
      d += `L${xs[run.at(-1) as number].toFixed(1)},${base.toFixed(1)}Z`;
    }
    run = [];
  };
  values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) flush();
    else run.push(i);
  });
  flush();
  return d;
}

export function TimeChart({
  title,
  x,
  series,
  height = 240,
  formatY,
  formatX,
  formatXLong,
  curve = "linear",
  shadeFrom,
  shadeLabel,
  marker,
  zero = true,
  emptyText = "Още няма данни",
}: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);
  const titleId = useId();

  const geometry = useMemo(() => {
    const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    if (x.length < 2 || values.length === 0) return null;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (zero) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
    const ticks = niceTicks(min, max, height < 200 ? 3 : 4);
    const yMin = ticks[0];
    const yMax = ticks.at(-1) as number;
    const plotW = Math.max(width - PAD.left - PAD.right, 10);
    const plotH = height - PAD.top - PAD.bottom;
    const x0 = x[0];
    const x1 = x.at(-1) as number;
    const sx = (t: number) => PAD.left + ((t - x0) / (x1 - x0 || 1)) * plotW;
    const sy = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
    const xs = x.map(sx);
    // ~1 x label per 110px, aligned to data positions.
    const every = Math.max(1, Math.ceil(x.length / Math.max(2, Math.floor(plotW / 110))));
    const xTicks = x.map((t, i) => ({ t, i })).filter(({ i }) => i % every === 0);
    return { ticks, sx, sy, xs, xTicks, plotW, plotH };
  }, [series, x, width, height, zero]);

  if (!geometry) {
    return (
      <div ref={ref} className="chart">
        <p className="chart-empty" style={{ minHeight: height }}>
          {emptyText}
        </p>
      </div>
    );
  }

  const { ticks, sx, sy, xs, xTicks, plotH } = geometry;
  const baseline = sy(Math.max(ticks[0], Math.min(0, ticks.at(-1) as number)));

  function nearest(clientX: number, rect: DOMRect): number {
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    return best;
  }

  function onPointer(event: PointerEvent<SVGSVGElement>) {
    setCursor(nearest(event.clientX, event.currentTarget.getBoundingClientRect()));
  }

  function onKey(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setCursor((current) => Math.min(Math.max((current ?? (step < 0 ? x.length : -1)) + step, 0), x.length - 1));
    } else if (event.key === "Escape") {
      setCursor(null);
    }
  }

  const cursorX = cursor === null ? null : xs[cursor];
  const tooltipLeft = cursorX === null ? 0 : Math.min(Math.max(cursorX + 12, 0), width - 180);
  const flip = cursorX !== null && cursorX + 12 + 170 > width;
  const long = formatXLong ?? formatX;

  return (
    <div ref={ref} className="chart">
      {series.length > 1 && (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.key} data-tone={s.tone} style={{ ["--tone" as string]: `var(--${s.tone})` }}>
              <span className="legend-key" data-shape={s.style === "area" ? "rect" : s.style === "dash" ? "dash" : undefined} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-labelledby={titleId}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={onKey}
        onBlur={() => setCursor(null)}
      >
        {/* One string: React renders a <title> with several children as empty. */}
        <title id={titleId}>{`${title}. Използвайте стрелките наляво и надясно, за да прочетете стойностите.`}</title>
        {shadeFrom !== undefined && shadeFrom < (x.at(-1) as number) && (
          <g>
            <rect
              className="chart-forecast-band"
              x={sx(Math.max(shadeFrom, x[0]))}
              y={PAD.top}
              width={sx(x.at(-1) as number) - sx(Math.max(shadeFrom, x[0]))}
              height={plotH}
            />
            {shadeLabel && (
              <text className="chart-tick" x={sx(Math.max(shadeFrom, x[0])) + 6} y={PAD.top + 12}>
                {shadeLabel}
              </text>
            )}
          </g>
        )}
        {ticks.map((tick) => (
          <g key={tick}>
            <line className={tick === 0 ? "chart-axis" : "chart-grid"} x1={PAD.left} x2={width - PAD.right} y1={sy(tick)} y2={sy(tick)} />
            <text className="chart-tick" x={PAD.left - 8} y={sy(tick) + 3.5} textAnchor="end">
              {formatY(tick)}
            </text>
          </g>
        ))}
        {xTicks.map(({ t, i }) => (
          <text key={t} className="chart-tick" x={xs[i]} y={height - 8} textAnchor={i === 0 ? "start" : "middle"}>
            {formatX(t)}
          </text>
        ))}
        {series.map((s) =>
          s.style === "area" ? (
            <path key={`${s.key}-area`} className="chart-area" d={areaFor(s.values, xs, sy, baseline)} fill={`var(--${s.tone})`} />
          ) : null,
        )}
        {series.map((s) => (
          <path
            key={s.key}
            className="chart-line"
            d={pathFor(s.values, xs, sy, curve)}
            stroke={`var(--${s.tone})`}
            strokeDasharray={s.style === "dash" ? "5 4" : undefined}
          />
        ))}
        {marker && marker.x >= x[0] && marker.x <= (x.at(-1) as number) && (
          <g>
            <line className="chart-now" x1={sx(marker.x)} x2={sx(marker.x)} y1={PAD.top} y2={PAD.top + plotH} />
            <text className="chart-tick" x={sx(marker.x) + 4} y={PAD.top + plotH - 4}>
              {marker.label}
            </text>
          </g>
        )}
        {cursorX !== null && cursor !== null && (
          <g>
            <line className="chart-cursor" x1={cursorX} x2={cursorX} y1={PAD.top} y2={PAD.top + plotH} />
            {series.map((s) => {
              const value = s.values[cursor];
              if (value === null || value === undefined || !Number.isFinite(value)) return null;
              return (
                <circle
                  key={s.key}
                  cx={cursorX}
                  cy={sy(value)}
                  r={4}
                  fill={`var(--${s.tone})`}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}
      </svg>
      {cursor !== null && cursorX !== null && (
        <div
          className="tooltip"
          style={{ left: flip ? Math.max(cursorX - 12 - 170, 0) : tooltipLeft, top: series.length > 1 ? 36 : 4 }}
          aria-hidden="true"
        >
          <p className="tooltip-title">{long(x[cursor])}</p>
          {series.map((s) => {
            const value = s.values[cursor];
            return (
              <div key={s.key} className="tooltip-row" style={{ ["--tone" as string]: `var(--${s.tone})` }}>
                <span className="tooltip-key" />
                <strong>{value === null || value === undefined ? "—" : formatY(value)}</strong>
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
      <details className="table-view">
        <summary>Покажи като таблица</summary>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Час</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {x.map((t, i) => (
                <tr key={t}>
                  <td>{long(t)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="right">
                      {s.values[i] === null || s.values[i] === undefined ? "—" : formatY(s.values[i] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
