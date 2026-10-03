"use client";

import Link from "next/link";
import { useMemo } from "react";
import { EnergyFlow } from "@/components/energy-flow";
import { DeviceList } from "@/components/device-list";
import { useSiteLive, type Connection } from "@/hooks/use-site-live";
import type { Command, Device, DeviceKind, SiteSummary } from "@/lib/api";
import { COMMAND_LABELS, formatPercent, formatPower, selfSufficiency, type FlowNode } from "@/lib/energy";
import { latestCommandByDevice } from "@/lib/live-state";

const CONNECTION_TEXT: Record<Connection, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  "not-found": "Unavailable",
};

function hasKind(devices: Device[], kind: DeviceKind) {
  return devices.some((device) => device.kind === kind);
}

const FLOW_KINDS: [FlowNode, DeviceKind][] = [
  ["solar", "solar_inverter"],
  ["grid", "grid_meter"],
  ["battery", "battery"],
  ["ev", "ev_charger"],
];

function presentFlows(devices: Device[]): Set<FlowNode> {
  return new Set(FLOW_KINDS.filter(([, kind]) => hasKind(devices, kind)).map(([node]) => node));
}

function Kpis({ summary, devices }: { summary: SiteSummary; devices: Device[] }) {
  const grid = summary.grid_w;
  const battery = summary.battery_w;
  const sufficiency = selfSufficiency(summary);
  const missing = (kind: DeviceKind, label: string) => (hasKind(devices, kind) ? "Offline" : label);

  const cards = [
    {
      label: "Solar",
      value: formatPower(summary.solar_w),
      note: summary.solar_w === null ? missing("solar_inverter", "No solar") : "production",
      tone: "solar",
    },
    {
      label: "Grid",
      value: grid === null ? "—" : formatPower(Math.abs(grid)),
      note:
        grid === null
          ? missing("grid_meter", "No grid meter")
          : grid > 20
            ? "importing"
            : grid < -20
              ? "exporting"
              : "balanced",
      tone: "grid",
    },
    {
      label: "Consumption",
      value: formatPower(summary.consumption_w),
      note: sufficiency === null ? "total site use" : `${formatPercent(sufficiency)} self-sufficient`,
      tone: "home",
    },
    {
      label: "Battery",
      value: formatPercent(summary.battery_soc_pct),
      note:
        battery === null
          ? missing("battery", "No battery")
          : battery > 20
            ? `charging ${formatPower(battery)}`
            : battery < -20
              ? `discharging ${formatPower(-battery)}`
              : "idle",
      tone: "battery",
    },
  ];

  return (
    <dl className="kpis">
      {cards.map((card) => (
        <div key={card.label} className="kpi" data-tone={card.tone}>
          <dt>{card.label}</dt>
          <dd>
            <span className="metric-value">{card.value}</span>
            <span className="metric-label">{card.note}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function describe(command: Command): string {
  if (command.type === "switch") return command.params.on ? "Turn on" : "Turn off";
  const watts = Number(command.params.power_w);
  return watts === 0 ? "Stop" : `Limit to ${formatPower(watts)}`;
}

function RecentCommands({ commands, devices }: { commands: Command[]; devices: Device[] }) {
  const names = new Map(devices.map((device) => [device.id, device.name]));
  if (commands.length === 0) {
    return <p className="muted">No commands yet. Use a device control to send one.</p>;
  }
  return (
    <ol className="command-log">
      {commands.map((command) => (
        <li key={command.id}>
          <time dateTime={command.created_at}>
            {new Date(command.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </time>
          <span>
            {names.get(command.device_id) ?? "Unknown device"} · {describe(command)}
          </span>
          <span className="command-status" data-status={command.status}>
            {COMMAND_LABELS[command.status]}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SiteDashboard({ siteId }: { siteId: string }) {
  const { snapshot, commands, connection, sendCommand } = useSiteLive(siteId);
  const latest = useMemo(() => latestCommandByDevice(commands), [commands]);
  const recent = useMemo(
    () =>
      Object.values(commands)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 8),
    [commands],
  );

  if (connection === "not-found") {
    return (
      <section className="empty-state">
        <h1>Site not found</h1>
        <p>It may have been removed, or the link is wrong.</p>
        <Link href="/">Back to all sites</Link>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="empty-state" aria-busy="true">
        <p>{connection === "reconnecting" ? "Cannot reach the OptiMesh API. Retrying…" : "Loading live data…"}</p>
      </section>
    );
  }

  const { site, devices, live } = snapshot;
  const updated = site.summary.updated_at
    ? new Date(site.summary.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <>
      <div className="page-title">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Sites</Link> <span aria-hidden="true">/</span> {site.name}
          </nav>
          <h1>{site.name}</h1>
        </div>
        <p className="connection-pill" data-state={connection} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {CONNECTION_TEXT[connection]}
          {updated && connection === "live" ? <span className="muted"> · {updated}</span> : null}
        </p>
      </div>

      <Kpis summary={site.summary} devices={devices} />

      <div className="dashboard-grid">
        <section className="panel" aria-labelledby="flow-title">
          <div className="panel-head">
            <h2 id="flow-title">Energy flow</h2>
            <span className="muted">
              {site.summary.devices_online} of {site.summary.devices_total} devices reporting
            </span>
          </div>
          <EnergyFlow summary={site.summary} present={presentFlows(devices)} />
          {site.summary.unmeasured_w !== null && site.summary.unmeasured_w > 0 && (
            <p className="footnote">
              Includes {formatPower(site.summary.unmeasured_w)} of consumption not measured by an individual device.
            </p>
          )}
        </section>

        <section className="panel" aria-labelledby="devices-title">
          <div className="panel-head">
            <h2 id="devices-title">Devices</h2>
          </div>
          <DeviceList devices={devices} live={live} commands={latest} send={sendCommand} />
        </section>

        <section className="panel panel-wide" aria-labelledby="commands-title">
          <div className="panel-head">
            <h2 id="commands-title">Recent commands</h2>
            <span className="muted">“Applied” means the device confirmed it.</span>
          </div>
          <RecentCommands commands={recent} devices={devices} />
        </section>
      </div>
    </>
  );
}
