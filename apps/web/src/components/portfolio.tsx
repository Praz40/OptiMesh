"use client";

import { ConnectionStatus } from "@/components/connection-status";
import { SiteCard } from "@/components/site-card";
import { useSites } from "@/hooks/use-sites";
import type { Site } from "@/lib/api";
import { formatPower } from "@/lib/energy";

function total(sites: Site[], pick: (site: Site) => number | null): number | null {
  const values = sites.map(pick).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function Portfolio() {
  const state = useSites();

  if (state.status === "loading") {
    return <p className="muted" aria-busy="true">Loading sites…</p>;
  }
  if (state.status === "error") {
    return (
      <>
        <p className="notice" role="alert">
          Could not load sites ({state.message}). Check that the API is running and seeded.
        </p>
        <ConnectionStatus />
      </>
    );
  }

  const { sites, stale } = state;
  const grid = total(sites, (site) => site.summary.grid_w);
  return (
    <>
      {stale && (
        <p className="notice" role="status">
          Connection lost. Showing the last known values.
        </p>
      )}
      <dl className="kpis portfolio-totals">
        <div className="kpi" data-tone="home">
          <dt>Total consumption</dt>
          <dd>
            <span className="metric-value">{formatPower(total(sites, (s) => s.summary.consumption_w))}</span>
            <span className="metric-label">across {sites.length} sites</span>
          </dd>
        </div>
        <div className="kpi" data-tone="solar">
          <dt>Solar production</dt>
          <dd>
            <span className="metric-value">{formatPower(total(sites, (s) => s.summary.solar_w))}</span>
            <span className="metric-label">right now</span>
          </dd>
        </div>
        <div className="kpi" data-tone="grid">
          <dt>Net grid</dt>
          <dd>
            <span className="metric-value">{grid === null ? "—" : formatPower(Math.abs(grid))}</span>
            <span className="metric-label">{grid === null ? "no meters" : grid >= 0 ? "importing" : "exporting"}</span>
          </dd>
        </div>
      </dl>
      {sites.length === 0 ? (
        <p className="muted">No sites yet. Run the seed script to create the demo sites.</p>
      ) : (
        <div className="site-grid">
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      )}
    </>
  );
}
