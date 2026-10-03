import type { ReactNode } from "react";
import { BatteryIcon, BuildingIcon, CoinIcon, EvIcon, GridIcon, SolarIcon } from "@/components/icons";
import type { Device, DeviceKind, SiteSummary } from "@/lib/api";
import { formatMoney, formatPowerBg, formatPrice } from "@/lib/format";
import type { CostNow } from "@/lib/insights";
import {
  batteryDirection,
  formatPercent,
  formatPower,
  gridDirection,
  powerParts,
  selfSufficiency,
} from "@/lib/energy";

export type Tile = {
  key: string;
  label: string;
  icon: ReactNode;
  tone: string;
  value: string;
  unit?: string;
  note: string;
  meter?: number | null;
};

export function KpiTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="kpis">
      {tiles.map((tile) => (
        <div key={tile.key} className="kpi" data-tone={tile.tone}>
          <dt>
            {tile.icon}
            {tile.label}
          </dt>
          <dd>
            <span className="metric-value">
              {tile.value}
              {tile.unit && <span className="metric-unit">{tile.unit}</span>}
            </span>
            <span className="metric-label">{tile.note}</span>
            {tile.meter != null && (
              <div className="meter" role="presentation">
                <span style={{ width: `${Math.min(Math.max(tile.meter, 0), 100)}%` }} />
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "Cost now": grid power × this hour's price, per hour. Negative while exporting. */
export function costNowTile(cost: CostNow): Tile {
  const power = `${formatPowerBg(Math.abs(cost.gridW))} × ${formatPrice(cost.price, cost.currency)}`;
  return {
    key: "cost-now",
    label: "Разход в момента",
    icon: <CoinIcon />,
    tone: "price",
    value: formatMoney(cost.perHour, cost.currency),
    unit: "/ч",
    note: cost.direction === "export" ? `приход: отдаване ${power}` : `покупка ${power}`,
  };
}

function hasKind(devices: Device[], kind: DeviceKind) {
  return devices.some((device) => device.kind === kind);
}

function powerTile(watts: number | null): Pick<Tile, "value" | "unit"> {
  const [value, unit] = powerParts(watts === null ? null : Math.abs(watts));
  return { value, unit };
}

/** The live headline numbers for one site. Tiles for equipment the site does not have are omitted. */
export function siteTiles(summary: SiteSummary, devices: Device[], extra: Tile[] = []): Tile[] {
  const offline = "Not reporting";
  const tiles: Tile[] = [];
  const sufficiency = selfSufficiency(summary);

  if (hasKind(devices, "solar_inverter")) {
    tiles.push({
      key: "solar",
      label: "Solar",
      icon: <SolarIcon />,
      tone: "solar",
      ...powerTile(summary.solar_w),
      note: summary.solar_w === null ? offline : summary.solar_w > 20 ? "producing" : "not producing",
    });
  }
  if (hasKind(devices, "grid_meter")) {
    const direction = gridDirection(summary.grid_w);
    tiles.push({
      key: "grid",
      label: "Grid",
      icon: <GridIcon />,
      tone: "grid",
      ...powerTile(summary.grid_w),
      note: direction ?? offline,
    });
  }
  if (hasKind(devices, "battery")) {
    const direction = batteryDirection(summary.battery_w);
    const [value, unit] = summary.battery_soc_pct === null ? ["—", ""] : [String(Math.round(summary.battery_soc_pct)), "%"];
    tiles.push({
      key: "battery",
      label: "Battery",
      icon: <BatteryIcon level={summary.battery_soc_pct} />,
      tone: "battery",
      value,
      unit,
      note:
        direction === null
          ? offline
          : direction === "idle"
            ? "idle"
            : `${direction} ${formatPower(Math.abs(summary.battery_w ?? 0))}`,
      meter: summary.battery_soc_pct,
    });
  }
  if (hasKind(devices, "ev_charger")) {
    const chargers = devices.filter((device) => device.kind === "ev_charger").length;
    tiles.push({
      key: "ev",
      label: "EV charging",
      icon: <EvIcon />,
      tone: "ev",
      ...powerTile(summary.ev_w),
      note: summary.ev_w === null ? offline : `${chargers} charger${chargers === 1 ? "" : "s"}`,
    });
  }
  tiles.push({
    key: "consumption",
    label: "Consumption",
    icon: <BuildingIcon />,
    tone: "consumption",
    ...powerTile(summary.consumption_w),
    note: sufficiency === null ? "total site use" : `${formatPercent(sufficiency)} self-supplied`,
    meter: sufficiency,
  });
  return [...tiles, ...extra];
}
