import Link from "next/link";
import type { Site } from "@/lib/api";
import { formatPercent, formatPower } from "@/lib/energy";

function gridText(watts: number | null): { label: string; value: string } {
  if (watts === null) return { label: "Grid", value: "—" };
  if (watts < 0) return { label: "Exporting", value: formatPower(-watts) };
  return { label: "Importing", value: formatPower(watts) };
}

export function SiteCard({ site }: { site: Site }) {
  const { summary } = site;
  const offline = summary.devices_total - summary.devices_online;
  const grid = gridText(summary.grid_w);
  return (
    <Link className="site-card" href={`/sites/${site.id}`}>
      <div className="site-card-head">
        <h2>{site.name}</h2>
        {offline > 0 ? (
          <span className="chip chip-warn">
            {offline} of {summary.devices_total} offline
          </span>
        ) : (
          <span className="chip chip-ok">All {summary.devices_total} online</span>
        )}
      </div>
      <p className="site-card-main">
        <span className="metric-value">{formatPower(summary.consumption_w)}</span>
        <span className="metric-label">consumption now</span>
      </p>
      <dl className="site-card-stats">
        <div>
          <dt>Solar</dt>
          <dd>{formatPower(summary.solar_w)}</dd>
        </div>
        <div>
          <dt>{grid.label}</dt>
          <dd>{grid.value}</dd>
        </div>
        <div>
          <dt>Battery</dt>
          <dd>{formatPercent(summary.battery_soc_pct)}</dd>
        </div>
        <div>
          <dt>EV</dt>
          <dd>{formatPower(summary.ev_w)}</dd>
        </div>
      </dl>
    </Link>
  );
}
