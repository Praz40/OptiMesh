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
          {offline} от {devices.length} устройства {offline === 1 ? "не изпраща" : "не изпращат"} данни. Смята се, че
          устройство не е на линия, ако 15 секунди не е изпратило телеметрия; управлението му остава недостъпно, докато не
          се върне.
        </p>
      )}
      <section className="panel" aria-labelledby="supply-title">
        <div className="panel-head">
          <h2 id="supply-title">Захранване и съхранение</h2>
          <span className="muted">Мрежа, слънце и батерии</span>
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
          <h2 id="loads-title">Товари</h2>
          <span className="muted">Зарядни станции, климатизация, бойлери и други консуматори</span>
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
