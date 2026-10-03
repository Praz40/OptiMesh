import Link from "next/link";
import type { Site } from "@/lib/api";
import { formatPercent, formatPower, gridDirection, powerParts, siteHealth, supplyMix } from "@/lib/energy";

const SOURCE_LABELS = { solar: "Слънце", battery: "Батерия", grid: "Мрежа" } as const;

function SupplyBar({ site }: { site: Site }) {
  const mix = supplyMix(site.summary);
  const total = mix.reduce((sum, share) => sum + share.watts, 0);
  if (total <= 0) return <div className="balance-bar" aria-hidden="true" />;
  const label = mix.map((share) => `${SOURCE_LABELS[share.source]} ${formatPercent((share.watts / total) * 100)}`).join(", ");
  return (
    <div className="balance-bar" role="img" aria-label={`Източници: ${label}`} title={label}>
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
          <span className="metric-label">консумация в момента</span>
        </p>
      </div>
      <SupplyBar site={site} />
      <dl className="site-card-stats">
        <div data-tone="solar">
          <dt>Слънце</dt>
          <dd>{formatPower(summary.solar_w)}</dd>
        </div>
        <div data-tone="grid">
          <dt>{grid === "exporting" ? "Към мрежата" : grid === "importing" ? "От мрежата" : "Мрежа"}</dt>
          <dd>{formatPower(summary.grid_w === null ? null : Math.abs(summary.grid_w))}</dd>
        </div>
        <div data-tone="battery">
          <dt>Батерия</dt>
          <dd>{formatPercent(summary.battery_soc_pct)}</dd>
        </div>
        <div data-tone="ev">
          <dt>Зареждане</dt>
          <dd>{formatPower(summary.ev_w)}</dd>
        </div>
      </dl>
    </Link>
  );
}
