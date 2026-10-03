"use client";

import { useMemo } from "react";
import { DeviceList } from "@/components/device-list";
import { ModeNotice } from "@/components/mode-notice";
import { useSiteLive } from "@/hooks/use-site-live";
import { useSiteMode } from "@/hooks/use-site-mode";
import type { Device, DeviceKind } from "@/lib/api";
import { latestCommandByDevice } from "@/lib/live-state";
import { canSendCommands } from "@/lib/site-mode";

const SUPPLY: DeviceKind[] = ["grid_meter", "solar_inverter", "battery"];
const isSupply = (device: Device) => SUPPLY.includes(device.kind);

export function SiteDevices() {
  const { snapshot, commands } = useSiteLive();
  const { mode, send } = useSiteMode();
  const latest = useMemo(() => latestCommandByDevice(commands), [commands]);
  if (!snapshot) return null;
  const { devices, live } = snapshot;
  const offline = live.filter((item) => !item.online).length;

  return (
    <div className="stack">
      {!canSendCommands(mode) && <ModeNotice mode={mode} />}
      {offline > 0 && (
        <p className="notice" role="status">
          {offline} of {devices.length} devices are not reporting. A device counts as offline after 15 s without
          telemetry; its controls stay disabled until it is back.
        </p>
      )}
      <section className="panel" aria-labelledby="supply-title">
        <div className="panel-head">
          <h2 id="supply-title">Supply and storage</h2>
          <span className="muted">Grid, solar and batteries</span>
        </div>
        <DeviceList
          devices={devices}
          live={live}
          commands={latest}
          send={send}
          readOnly={!canSendCommands(mode)}
          filter={isSupply}
        />
      </section>
      <section className="panel" aria-labelledby="loads-title">
        <div className="panel-head">
          <h2 id="loads-title">Loads</h2>
          <span className="muted">EV chargers, HVAC, boilers and other consumers</span>
        </div>
        <DeviceList
          devices={devices}
          live={live}
          commands={latest}
          send={send}
          readOnly={!canSendCommands(mode)}
          filter={(device) => !isSupply(device)}
        />
      </section>
    </div>
  );
}
