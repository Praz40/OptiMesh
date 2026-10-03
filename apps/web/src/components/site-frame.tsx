"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useNow } from "@/hooks/use-now";
import { useSiteLive, type Connection } from "@/hooks/use-site-live";
import { useSites } from "@/hooks/use-sites";
import { formatAgo } from "@/lib/energy";

const CONNECTION: Record<Connection, { text: string; tone?: "good" | "warn" | "bad" }> = {
  connecting: { text: "Connecting…" },
  live: { text: "Live", tone: "good" },
  reconnecting: { text: "Reconnecting…", tone: "warn" },
  "not-found": { text: "Unavailable", tone: "bad" },
};

export const SITE_TABS = [
  { slug: "", label: "Overview" },
  { slug: "devices", label: "Devices" },
  { slug: "activity", label: "Activity" },
  { slug: "forecast", label: "Прогноза" },
  { slug: "costs", label: "Разходи" },
] as const;

function SiteSwitcher({ siteId, tab }: { siteId: string; tab: string }) {
  const sites = useSites();
  const router = useRouter();
  if (sites.status !== "ready" || sites.sites.length < 2) return null;
  return (
    <label className="site-switch">
      <span aria-hidden="true">Site</span>
      <select
        aria-label="Switch site"
        value={siteId}
        onChange={(event) => router.push(`/sites/${event.target.value}${tab ? `/${tab}` : ""}`)}
      >
        {sites.sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function LivePill({ connection, updatedAt }: { connection: Connection; updatedAt: string | null }) {
  const now = useNow();
  const { text, tone } = CONNECTION[connection];
  return (
    <p className="pill" aria-live="polite">
      <span className="status-dot" data-tone={tone} aria-hidden="true" />
      {text}
      {connection === "live" && updatedAt && <span className="muted">updated {formatAgo(updatedAt, now)}</span>}
    </p>
  );
}

export function SiteFrame({ children }: { children: ReactNode }) {
  const { siteId, snapshot, connection } = useSiteLive();
  const pathname = usePathname();
  const base = `/sites/${siteId}`;
  const tab = pathname.slice(base.length).replace(/^\//, "").split("/")[0] ?? "";

  if (connection === "not-found") {
    return (
      <section className="empty-state">
        <h1>Site not found</h1>
        <p>It may have been removed, or the link is wrong.</p>
        <Link className="button" href="/">
          Back to all sites
        </Link>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="empty-state" aria-busy="true">
        <p>{connection === "reconnecting" ? "Cannot reach the OptiMesh API. Retrying…" : "Loading live data…"}</p>
      </section>
    );
  }

  const { site } = snapshot;
  return (
    <>
      <div className="page-head">
        <div>
          <nav className="eyebrow" aria-label="Breadcrumb">
            <Link href="/">Portfolio</Link>
            <span aria-hidden="true">/</span>
            <span>{site.timezone.replace("_", " ")}</span>
          </nav>
          <h1>{site.name}</h1>
        </div>
        <div className="head-actions">
          <SiteSwitcher siteId={siteId} tab={tab} />
          <LivePill connection={connection} updatedAt={site.summary.updated_at} />
        </div>
      </div>
      {connection === "reconnecting" && (
        <p className="notice" role="status">
          Connection to the API was lost. Showing the last known values while reconnecting.
        </p>
      )}
      <nav className="tabs" aria-label={`${site.name} sections`}>
        {SITE_TABS.map((item) => (
          <Link
            key={item.slug}
            className="tab"
            href={item.slug ? `${base}/${item.slug}` : base}
            aria-current={tab === item.slug ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
