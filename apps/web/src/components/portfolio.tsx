"use client";

import { ConnectionStatus } from "@/components/connection-status";
import { BuildingIcon, GridIcon, SiteIcon, SolarIcon } from "@/components/icons";
import { SiteCard } from "@/components/site-card";
import { KpiTiles } from "@/components/site-kpis";
import { useSites } from "@/hooks/use-sites";
import type { Site } from "@/lib/api";
import { GRID_LABELS, gridDirection, powerParts } from "@/lib/energy";

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
        Зареждане на обектите…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <p className="notice" role="alert">
          Обектите не се заредиха ({state.message}). Проверете дали API работи и има демо данни.
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
          Връзката прекъсна. Показани са последните известни стойности.
        </p>
      )}
      <KpiTiles
        tiles={[
          {
            key: "consumption",
            label: "Обща консумация",
            icon: <BuildingIcon />,
            tone: "consumption",
            ...power(total(sites, (s) => s.summary.consumption_w)),
            note: `в ${sites.length} ${sites.length === 1 ? "обект" : "обекта"}`,
          },
          {
            key: "solar",
            label: "Слънчево производство",
            icon: <SolarIcon />,
            tone: "solar",
            ...power(total(sites, (s) => s.summary.solar_w)),
            note: "в момента",
          },
          {
            key: "grid",
            label: "Мрежа (нетно)",
            icon: <GridIcon />,
            tone: "grid",
            ...power(grid === null ? null : Math.abs(grid)),
            note: direction ? GRID_LABELS[direction] : "няма електромери",
          },
          {
            key: "sites",
            label: "Обекти с данни",
            icon: <SiteIcon />,
            tone: "battery",
            value: `${online}`,
            unit: `/ ${sites.length}`,
            note: online === sites.length ? "всички на живо" : "някои не изпращат данни",
          },
        ]}
      />
      {sites.length === 0 ? (
        <section className="empty-state">
          <h2>Още няма обекти</h2>
          <p>Пуснете скрипта за демо данни (app.seed), за да създадете обектите Home, Workshop и Office.</p>
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
