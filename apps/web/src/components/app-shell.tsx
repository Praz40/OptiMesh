"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BrandMark, MenuIcon, PortfolioIcon, SimulatorIcon, SiteIcon } from "@/components/icons";
import { useSites } from "@/hooks/use-sites";
import type { Site } from "@/lib/api";
import { formatPower, siteHealth } from "@/lib/energy";

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="OptiMesh – начало">
      <BrandMark className="brand-mark" />
      <span className="brand-name">
        Opti<span>Mesh</span>
      </span>
    </Link>
  );
}

function SiteLink({ site, active }: { site: Site; active: boolean }) {
  const health = siteHealth(site.summary);
  return (
    <Link className="nav-link" href={`/sites/${site.id}`} data-active={active}>
      <SiteIcon />
      <span>{site.name}</span>
      <span className="nav-site-meta">{formatPower(site.summary.consumption_w)}</span>
      <span className="status-dot" data-tone={health.tone} title={health.label} />
    </Link>
  );
}

function SidebarFooter() {
  const sites = useSites();
  const text =
    sites.status === "loading"
      ? "Свързване с OptiMesh…"
      : sites.status === "error" || sites.stale
        ? "Няма връзка с API"
        : "Свързано с OptiMesh API";
  const tone = sites.status === "ready" && !sites.stale ? "good" : sites.status === "loading" ? undefined : "warn";
  return (
    <div className="sidebar-foot">
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="status-dot" data-tone={tone} aria-hidden="true" />
        {text}
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const sites = useSites();
  const [open, setOpen] = useState(false);

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <button
          type="button"
          className="button-ghost"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((value) => !value)}
        >
          <MenuIcon width={20} height={20} />
          <span className="sr-only">Меню</span>
        </button>
      </header>
      <aside
        className="sidebar"
        id="sidebar"
        data-open={open}
        // Close the mobile menu after following any link inside it.
        onClick={(event) => {
          if ((event.target as Element).closest("a")) setOpen(false);
        }}
      >
        <Brand />
        <nav className="nav-section" aria-label="Основна навигация">
          <Link className="nav-link" href="/" aria-current={pathname === "/" ? "page" : undefined}>
            <PortfolioIcon />
            Портфолио
          </Link>
          <Link className="nav-link" href="/simulator" aria-current={pathname === "/simulator" ? "page" : undefined}>
            <SimulatorIcon />
            Симулатор
          </Link>
        </nav>
        <nav className="nav-section" aria-labelledby="sites-heading">
          <p className="nav-heading" id="sites-heading">
            Обекти
          </p>
          {sites.status === "ready" &&
            sites.sites.map((site) => (
              <SiteLink key={site.id} site={site} active={pathname.startsWith(`/sites/${site.id}`)} />
            ))}
          {sites.status === "loading" && <p className="muted" style={{ padding: "0 10px" }}>Зареждане…</p>}
          {sites.status === "error" && <p className="muted" style={{ padding: "0 10px" }}>Недостъпно</p>}
        </nav>
        <SidebarFooter />
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
