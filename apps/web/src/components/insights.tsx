import type { ReactNode } from "react";
import { AlertIcon, BatteryIcon, CheckIcon, GridIcon, LeafIcon, SolarIcon } from "@/components/icons";
import type { Device, DeviceLive, SiteSummary } from "@/lib/api";
import { formatPercent, formatPower, gridDirection, supplyMix } from "@/lib/energy";

type Insight = { key: string; icon: ReactNode; tone?: string; title: string; detail: string };

const SOURCE_LABEL = { solar: "solar", battery: "the battery", grid: "the grid" } as const;

/** Plain-language reading of the live balance: where power comes from, where it goes, what needs attention. */
export function liveInsights(summary: SiteSummary, devices: Device[], live: DeviceLive[]): Insight[] {
  const insights: Insight[] = [];
  const mix = supplyMix(summary);
  const consumption = summary.consumption_w;

  if (mix.length > 0 && consumption) {
    const parts = mix
      .sort((a, b) => b.watts - a.watts)
      .map((share) => `${formatPercent((share.watts / consumption) * 100)} from ${SOURCE_LABEL[share.source]}`);
    const lead = mix[0];
    insights.push({
      key: "mix",
      icon: lead.source === "solar" ? <LeafIcon /> : lead.source === "battery" ? <BatteryIcon /> : <GridIcon />,
      tone: lead.source === "solar" ? "solar" : lead.source,
      title: `${formatPower(consumption)} in use, mostly from ${SOURCE_LABEL[lead.source]}`,
      detail: `${parts.join(", ")}.`,
    });
  }

  const grid = gridDirection(summary.grid_w);
  if (grid === "exporting" && summary.grid_w !== null) {
    insights.push({
      key: "export",
      icon: <SolarIcon />,
      tone: "solar",
      title: `Exporting ${formatPower(-summary.grid_w)} of surplus`,
      detail: "Flexible loads such as EV charging could use this instead of selling it.",
    });
  } else if (grid === "importing" && summary.solar_w !== null && summary.solar_w < 50) {
    insights.push({
      key: "import",
      icon: <GridIcon />,
      tone: "grid",
      title: `Importing ${formatPower(summary.grid_w)} with no solar`,
      detail: "Deferring flexible loads to sunnier or cheaper hours would cut this.",
    });
  }

  const online = new Map(live.map((item) => [item.device_id, item.online]));
  const down = devices.filter((device) => online.get(device.id) === false);
  if (down.length > 0) {
    insights.push({
      key: "offline",
      icon: <AlertIcon />,
      title: `${down.length} device${down.length === 1 ? "" : "s"} not reporting`,
      detail: `${down.map((device) => device.name).join(", ")}. Totals that depend on ${down.length === 1 ? "it" : "them"} are incomplete.`,
    });
  } else if (devices.length > 0) {
    insights.push({
      key: "healthy",
      icon: <CheckIcon />,
      tone: "battery",
      title: "All devices reporting",
      detail: `${devices.length} device${devices.length === 1 ? "" : "s"} sent fresh readings in the last 15 s.`,
    });
  }
  return insights;
}

export function Insights({ items }: { items: Insight[] }) {
  if (items.length === 0) return <p className="muted">Waiting for enough readings to describe this site.</p>;
  return (
    <ul className="insights">
      {items.map((item) => (
        <li key={item.key} className="insight">
          <span className="insight-icon" data-tone={item.tone} aria-hidden="true">
            {item.icon}
          </span>
          <div>
            <p>{item.title}</p>
            <p>{item.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
