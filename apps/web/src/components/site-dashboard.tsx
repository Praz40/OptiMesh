"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CommandLog, sortedCommands } from "@/components/command-log";
import { DeviceList } from "@/components/device-list";
import { EnergyFlow } from "@/components/energy-flow";
import { Insights, liveInsights } from "@/components/insights";
import { ModeNotice } from "@/components/mode-notice";
import { Recommendations } from "@/components/recommendations";
import { costNowTile, KpiTiles, siteTiles } from "@/components/site-kpis";
import { TimeChart, type ChartSeries } from "@/components/time-chart";
import { usePolled } from "@/hooks/use-polled";
import { useSiteLive } from "@/hooks/use-site-live";
import { useSiteMode } from "@/hooks/use-site-mode";
import { api, type Device, type DeviceKind } from "@/lib/api";
import { formatClock, formatKw, formatPower, type FlowNode } from "@/lib/energy";
import { costNow, FORECAST_POLL_MS } from "@/lib/insights";
import { latestCommandByDevice } from "@/lib/live-state";
import { canSendCommands } from "@/lib/site-mode";
import type { TrendPoint } from "@/lib/trend";

const FLOW_KINDS: [FlowNode, DeviceKind][] = [
  ["solar", "solar_inverter"],
  ["grid", "grid_meter"],
  ["battery", "battery"],
  ["ev", "ev_charger"],
];

function presentFlows(devices: Device[]): Set<FlowNode> {
  return new Set(
    FLOW_KINDS.filter(([, kind]) => devices.some((device) => device.kind === kind)).map(([node]) => node),
  );
}

function trendSeries(points: TrendPoint[], devices: Device[]): ChartSeries[] {
  const has = (kind: DeviceKind) => devices.some((device) => device.kind === kind);
  const series: ChartSeries[] = [];
  if (has("solar_inverter")) {
    series.push({ key: "solar", label: "Solar", tone: "solar", style: "area", values: points.map((p) => p.solar) });
  }
  series.push({ key: "consumption", label: "Consumption", tone: "consumption", values: points.map((p) => p.consumption) });
  if (has("grid_meter")) {
    series.push({ key: "grid", label: "Grid (+ import / − export)", tone: "grid", values: points.map((p) => p.grid) });
  }
  if (has("battery")) {
    series.push({ key: "battery", label: "Battery (+ charge)", tone: "battery", values: points.map((p) => p.battery) });
  }
  return series;
}

function PowerTrend({ points, devices, backfilled }: { points: TrendPoint[]; devices: Device[]; backfilled: boolean }) {
  const series = useMemo(() => trendSeries(points, devices), [points, devices]);
  const x = useMemo(() => points.map((p) => p.t), [points]);
  return (
    <TimeChart
      title="Site power over the last 30 minutes"
      x={x}
      series={series}
      height={250}
      formatY={formatKw}
      formatX={(t) => formatClock(t)}
      formatXLong={(t) => formatClock(t, true)}
      emptyText={backfilled ? "Collecting readings…" : "Loading recent history…"}
    />
  );
}

const flexible = (device: Device) =>
  device.capabilities.includes("switch") || device.capabilities.includes("power_setpoint");

export function SiteDashboard() {
  const { snapshot, commands, trend, backfilled, siteId } = useSiteLive();
  const { mode, send } = useSiteMode();
  const latest = useMemo(() => latestCommandByDevice(commands), [commands]);
  const recent = useMemo(() => sortedCommands(commands, 5), [commands]);
  // Only for the current price of the "cost now" tile.
  const forecast = usePolled(api.forecast, siteId, FORECAST_POLL_MS);
  if (!snapshot) return null;

  const { site, devices, live } = snapshot;
  const { summary } = site;
  const cost = costNow(summary.grid_w, summary.updated_at, forecast.status === "ready" ? forecast.data : null);

  return (
    <>
      <KpiTiles tiles={siteTiles(summary, devices, cost ? [costNowTile(cost)] : [])} />

      <div className="grid-2">
        {mode === "assist" ? <Recommendations /> : <ModeNotice mode={mode} />}

        <section className="panel" aria-labelledby="flow-title">
          <div className="panel-head">
            <h2 id="flow-title">Energy flow</h2>
            <span className="muted">
              {summary.devices_online} of {summary.devices_total} devices reporting
            </span>
          </div>
          <EnergyFlow summary={summary} present={presentFlows(devices)} />
          {summary.unmeasured_w !== null && summary.unmeasured_w > 0 && (
            <p className="footnote">
              Site loads include {formatPower(summary.unmeasured_w)} not measured by an individual device.
            </p>
          )}
        </section>

        <div className="stack">
          <section className="panel" aria-labelledby="now-title">
            <div className="panel-head">
              <h2 id="now-title">Right now</h2>
            </div>
            <Insights items={liveInsights(summary, devices, live)} />
          </section>
          <section className="panel" aria-labelledby="recent-title">
            <div className="panel-head">
              <h2 id="recent-title">Recent activity</h2>
              <Link className="muted" href={`/sites/${siteId}/activity`}>
                View all
              </Link>
            </div>
            <CommandLog commands={recent} devices={devices} />
          </section>
        </div>

        <section className="panel span-all" aria-labelledby="trend-title">
          <div className="panel-head">
            <h2 id="trend-title">Power, last 30 minutes</h2>
            <span className="muted">10 s averages · live</span>
          </div>
          <PowerTrend points={trend} devices={devices} backfilled={backfilled} />
        </section>

        {devices.some(flexible) && (
          <section className="panel span-all" aria-labelledby="controls-title">
            <div className="panel-head">
              <h2 id="controls-title">Flexible loads</h2>
              <span className="muted">Changes apply only after the device confirms them.</span>
            </div>
            <DeviceList
              devices={devices}
              live={live}
              commands={latest}
              send={send}
              readOnly={!canSendCommands(mode)}
              filter={flexible}
            />
          </section>
        )}
      </div>
    </>
  );
}
