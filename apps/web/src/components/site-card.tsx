import Link from "next/link";
import type { Site } from "@/lib/api";
import { formatPercent, formatPower, gridDirection, powerParts, siteHealth, supplyMix } from "@/lib/energy";

const SOURCE_LABELS = { solar: "Solar", battery: "Battery", grid: "Grid" } as const;

function SupplyBar({ site }: { site: Site }) {
  const mix = supplyMix(site.summary);
  const total = mix.reduce((sum, share) => sum + share.watts, 0);
  if (total <= 0) return <div className="balance-bar" aria-hidden="true" />;
  const label = mix.map((share) => `${SOURCE_LABELS[share.source]} ${formatPercent((share.watts / total) * 100)}`).join(", ");
  return (
    <div className="balance-bar" role="img" aria-label={`Supplied by ${label}`} title={label}>
      {mix.map((share) => (
        <span key={share.source} data-tone={share.source} style={{ flexGrow: share.watts }} />
      ))}
    </div>
  );
}

export function SiteCard({ site }: { site: Site }) {
  const { summary } = site;
  const health = siteHealth(summary);
  const grid = gridDirection(summary.grid_w);
  const [value, unit] = powerParts(summary.consumption_w);
  return (
    <Link className="site-card" href={`/sites/${site.id}`}>
      <div className="site-card-head">
        <h2>{site.name}</h2>
        <span className="chip" data-tone={health.tone}>
          {health.label}
        </span>
      </div>
      <div className="site-card-main">
        <p>
          <span className="metric-value">
            {value}
            {unit && <span className="metric-unit">{unit}</span>}
          </span>
          <span className="metric-label">consumption now</span>
        </p>
      </div>
      <SupplyBar site={site} />
      <dl className="site-card-stats">
        <div data-tone="solar">
          <dt>Solar</dt>
          <dd>{formatPower(summary.solar_w)}</dd>
        </div>
        <div data-tone="grid">
          <dt>{grid === "exporting" ? "Exporting" : grid === "importing" ? "Importing" : "Grid"}</dt>
          <dd>{formatPower(summary.grid_w === null ? null : Math.abs(summary.grid_w))}</dd>
        </div>
        <div data-tone="battery">
          <dt>Battery</dt>
          <dd>{formatPercent(summary.battery_soc_pct)}</dd>
        </div>
        <div data-tone="ev">
          <dt>EV</dt>
          <dd>{formatPower(summary.ev_w)}</dd>
        </div>
      </dl>
    </Link>
  );
}
