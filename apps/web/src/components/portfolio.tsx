"use client";

import { ConnectionStatus } from "@/components/connection-status";
import { BuildingIcon, GridIcon, SiteIcon, SolarIcon } from "@/components/icons";
import { SiteCard } from "@/components/site-card";
import { KpiTiles } from "@/components/site-kpis";
import { useSites } from "@/hooks/use-sites";
import type { Site } from "@/lib/api";
import { gridDirection, powerParts } from "@/lib/energy";

function total(sites: Site[], pick: (site: Site) => number | null): number | null {
  const values = sites.map(pick).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function power(watts: number | null) {
  const [value, unit] = powerParts(watts);
  return { value, unit };
}

export function Portfolio() {
  const state = useSites();

  if (state.status === "loading") {
    return (
      <p className="muted" aria-busy="true">
        Loading sites…
      </p>
    );
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
  const direction = gridDirection(grid);
  const online = sites.filter((site) => site.summary.devices_online > 0).length;

  return (
    <>
      {stale && (
        <p className="notice" role="status">
          Connection lost. Showing the last known values.
        </p>
      )}
      <KpiTiles
        tiles={[
          {
            key: "consumption",
            label: "Total consumption",
            icon: <BuildingIcon />,
            tone: "consumption",
            ...power(total(sites, (s) => s.summary.consumption_w)),
            note: `across ${sites.length} site${sites.length === 1 ? "" : "s"}`,
          },
          {
            key: "solar",
            label: "Solar production",
            icon: <SolarIcon />,
            tone: "solar",
            ...power(total(sites, (s) => s.summary.solar_w)),
            note: "right now",
          },
          {
            key: "grid",
            label: "Net grid",
            icon: <GridIcon />,
            tone: "grid",
            ...power(grid === null ? null : Math.abs(grid)),
            note: direction ?? "no meters",
          },
          {
            key: "sites",
            label: "Sites reporting",
            icon: <SiteIcon />,
            tone: "battery",
            value: `${online}`,
            unit: `/ ${sites.length}`,
            note: online === sites.length ? "all live" : "some sites silent",
          },
        ]}
      />
      {sites.length === 0 ? (
        <section className="empty-state">
          <h2>No sites yet</h2>
          <p>Run the seed script to create the demo sites: Home, Workshop and Office.</p>
        </section>
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
