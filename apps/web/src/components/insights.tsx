import type { ReactNode } from "react";
import { AlertIcon, BatteryIcon, CheckIcon, GridIcon, LeafIcon, SolarIcon } from "@/components/icons";
import type { Device, DeviceLive, SiteSummary } from "@/lib/api";
import { devicesCount, formatPercent, formatPower, gridDirection, supplyMix } from "@/lib/energy";

type Insight = { key: string; icon: ReactNode; tone?: string; title: string; detail: string };

const SOURCE_LABEL = { solar: "слънцето", battery: "батерията", grid: "мрежата" } as const;

/** Plain-language reading of the live balance: where power comes from, where it goes, what needs attention. */
export function liveInsights(summary: SiteSummary, devices: Device[], live: DeviceLive[]): Insight[] {
  const insights: Insight[] = [];
  const mix = supplyMix(summary);
  const consumption = summary.consumption_w;

  if (mix.length > 0 && consumption) {
    const parts = mix
      .sort((a, b) => b.watts - a.watts)
      .map((share) => `${formatPercent((share.watts / consumption) * 100)} от ${SOURCE_LABEL[share.source]}`);
    const lead = mix[0];
    insights.push({
      key: "mix",
      icon: lead.source === "solar" ? <LeafIcon /> : lead.source === "battery" ? <BatteryIcon /> : <GridIcon />,
      tone: lead.source === "solar" ? "solar" : lead.source,
      title: `Консумация ${formatPower(consumption)}, най-вече от ${SOURCE_LABEL[lead.source]}`,
      detail: `${parts.join(", ")}.`,
    });
  }

  const grid = gridDirection(summary.grid_w);
  if (grid === "exporting" && summary.grid_w !== null) {
    insights.push({
      key: "export",
      icon: <SolarIcon />,
      tone: "solar",
      title: `${formatPower(-summary.grid_w)} излишък се отдава към мрежата`,
      detail: "Гъвкави товари, като зареждането на коли, могат да го използват, вместо той да се отдава към мрежата.",
    });
  } else if (grid === "importing" && summary.solar_w !== null && summary.solar_w < 50) {
    insights.push({
      key: "import",
      icon: <GridIcon />,
      tone: "grid",
      title: `${formatPower(summary.grid_w)} се взема от мрежата без слънце`,
      detail: "Ако гъвкавите товари се отложат за по-слънчеви или по-евтини часове, това ще намалее.",
    });
  }

  const online = new Map(live.map((item) => [item.device_id, item.online]));
  const down = devices.filter((device) => online.get(device.id) === false);
  if (down.length > 0) {
    insights.push({
      key: "offline",
      icon: <AlertIcon />,
      title: `${devicesCount(down.length)} не ${down.length === 1 ? "изпраща" : "изпращат"} данни`,
      detail: `${down.map((device) => device.name).join(", ")}. Сумите, които зависят от ${down.length === 1 ? "него" : "тях"}, са непълни.`,
    });
  } else if (devices.length > 0) {
    insights.push({
      key: "healthy",
      icon: <CheckIcon />,
      tone: "battery",
      title: "Всички устройства изпращат данни",
      detail: `${devicesCount(devices.length)} ${devices.length === 1 ? "изпрати" : "изпратиха"} нови измервания през последните 15 секунди.`,
    });
  }
  return insights;
}

export function Insights({ items }: { items: Insight[] }) {
  if (items.length === 0) return <p className="muted">Изчакване на достатъчно измервания, за да се опише обектът.</p>;
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
