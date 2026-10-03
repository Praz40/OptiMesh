"use client";

import { useState, type FormEvent } from "react";
import type { Command, CommandRequest, Device, DeviceLive } from "@/lib/api";
import { COMMAND_LABELS, formatPercent, formatPower, isFinalStatus, KIND_LABELS } from "@/lib/energy";

type Send = (deviceId: string, body: CommandRequest) => Promise<Command>;

function CommandNote({ command, error }: { command?: Command; error?: string }) {
  if (error) return <p className="command-note" data-tone="bad">{error}</p>;
  if (!command) return null;
  const tone =
    command.status === "applied" ? "good" : isFinalStatus(command.status) ? "bad" : "busy";
  return (
    <p className="command-note" data-tone={tone} aria-live="polite">
      {COMMAND_LABELS[command.status]}
      {command.reason ? `: ${command.reason}` : ""}
    </p>
  );
}

function SetpointForm({
  device,
  live,
  busy,
  onSubmit,
}: {
  device: Device;
  live: DeviceLive;
  busy: boolean;
  onSubmit: (watts: number) => void;
}) {
  const current = live.state?.setpoint_w;
  const [value, setValue] = useState(current ? String(current / 1000) : "");
  const min = (device.limits.min_power_w ?? 0) / 1000;
  const max = (device.limits.max_power_w ?? 0) / 1000;

  function submit(event: FormEvent) {
    event.preventDefault();
    const kw = Number(value);
    if (Number.isFinite(kw)) onSubmit(Math.round(kw * 1000));
  }

  return (
    <form className="setpoint" onSubmit={submit}>
      <label>
        <span className="sr-only">Power limit for {device.name} in kW</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={max || undefined}
          step={0.1}
          value={value}
          placeholder={`${min}–${max}`}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy || !live.online}
        />
        <span aria-hidden="true">kW</span>
      </label>
      <button type="submit" disabled={busy || !live.online || value === ""}>
        Set
      </button>
    </form>
  );
}

function DeviceRow({
  device,
  live,
  command,
  send,
}: {
  device: Device;
  live: DeviceLive;
  command?: Command;
  send: Send;
}) {
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || (command !== undefined && !isFinalStatus(command.status));
  const canSwitch = device.capabilities.includes("switch");
  const canSetpoint = device.capabilities.includes("power_setpoint");
  const on = live.state?.on;

  async function run(body: CommandRequest) {
    setError(undefined);
    setSubmitting(true);
    try {
      await send(device.id, body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Command failed");
    } finally {
      setSubmitting(false);
    }
  }

  const metrics = live.metrics;
  const detail = [
    KIND_LABELS[device.kind],
    metrics?.soc_pct != null ? `${formatPercent(metrics.soc_pct)} charged` : null,
    live.state?.setpoint_w != null ? `limit ${formatPower(live.state.setpoint_w)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="device-row" data-online={live.online}>
      <span className="status-dot" aria-hidden="true" />
      <div className="device-name">
        <p>
          {device.name}
          {device.source === "simulator" && <span className="tag">Simulated</span>}
        </p>
        <p className="device-detail">
          {live.online ? detail : `Offline · ${KIND_LABELS[device.kind]}`}
        </p>
        {canSetpoint && (
          <SetpointForm
            device={device}
            live={live}
            busy={busy}
            onSubmit={(watts) => void run({ type: "power_setpoint", params: { power_w: watts } })}
          />
        )}
        <CommandNote command={command} error={error} />
      </div>
      <p className="device-power">{live.online ? formatPower(metrics?.power_w) : "—"}</p>
      <div className="device-switch">
        {canSwitch && (
          <button
            type="button"
            role="switch"
            aria-checked={on === true}
            aria-label={`${device.name} power`}
            className="toggle"
            disabled={busy || !live.online}
            title={live.online ? undefined : "Device is offline"}
            onClick={() => void run({ type: "switch", params: { on: on !== true } })}
          >
            <span className="toggle-knob" />
          </button>
        )}
      </div>
    </li>
  );
}

export function DeviceList({
  devices,
  live,
  commands,
  send,
}: {
  devices: Device[];
  live: DeviceLive[];
  commands: Record<string, Command>;
  send: Send;
}) {
  const byId = new Map(live.map((item) => [item.device_id, item]));
  return (
    <ul className="device-list">
      {devices.map((device) => {
        const reading = byId.get(device.id);
        if (!reading) return null;
        return (
          <DeviceRow
            key={device.id}
            device={device}
            live={reading}
            command={commands[device.id]}
            send={send}
          />
        );
      })}
    </ul>
  );
}
