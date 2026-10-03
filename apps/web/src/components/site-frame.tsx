"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ModeSwitch } from "@/components/mode-switch";
import { useMySites } from "@/hooks/use-my-sites";
import { useNow } from "@/hooks/use-now";
import { useSiteLive, type Connection } from "@/hooks/use-site-live";
import { useSiteMode } from "@/hooks/use-site-mode";
import { useSites } from "@/hooks/use-sites";
import { formatAgo } from "@/lib/energy";

const CONNECTION: Record<Connection, { text: string; tone?: "good" | "warn" | "bad" }> = {
  connecting: { text: "Свързване…" },
  live: { text: "На живо", tone: "good" },
  reconnecting: { text: "Повторно свързване…", tone: "warn" },
  "not-found": { text: "Недостъпен", tone: "bad" },
};

export const SITE_TABS = [
  { slug: "", label: "Преглед" },
  { slug: "devices", label: "Устройства" },
  { slug: "activity", label: "Активност" },
  { slug: "forecast", label: "Прогноза" },
  { slug: "costs", label: "Разходи" },
] as const;

function SiteSwitcher({ siteId, tab }: { siteId: string; tab: string }) {
  const sites = useSites();
  const router = useRouter();
  if (sites.status !== "ready" || sites.sites.length < 2) return null;
  return (
    <label className="site-switch">
      <span aria-hidden="true">Обект</span>
      <select
        aria-label="Смяна на обекта"
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

/** For the signed-in owner only: where to add devices and see how to connect them. */
function OwnerLink({ siteId }: { siteId: string }) {
  const { state } = useMySites();
  if (state.status !== "ready" || !state.sites.some((site) => site.id === siteId)) return null;
  return (
    <Link className="button" href={`/my-sites/${siteId}`}>
      Добави устройство
    </Link>
  );
}

function LivePill({ connection, updatedAt }: { connection: Connection; updatedAt: string | null }) {
  const now = useNow();
  const { text, tone } = CONNECTION[connection];
  return (
    <p className="pill" aria-live="polite">
      <span className="status-dot" data-tone={tone} aria-hidden="true" />
      {text}
      {connection === "live" && updatedAt && <span className="muted">обновено {formatAgo(updatedAt, now)}</span>}
    </p>
  );
}

export function SiteFrame({ children }: { children: ReactNode }) {
  const { siteId, snapshot, connection } = useSiteLive();
  const { mode, select } = useSiteMode();
  const pathname = usePathname();
  const base = `/sites/${siteId}`;
  const tab = pathname.slice(base.length).replace(/^\//, "").split("/")[0] ?? "";

  if (connection === "not-found") {
    return (
      <section className="empty-state">
        <h1>Обектът не е намерен</h1>
        <p>Може да е премахнат или връзката да е грешна.</p>
        <Link className="button" href="/">
          Към всички обекти
        </Link>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="empty-state" aria-busy="true">
        <p>{connection === "reconnecting" ? "Няма връзка с OptiMesh API. Нов опит…" : "Зареждане на данните на живо…"}</p>
      </section>
    );
  }

  const { site } = snapshot;
  return (
    <>
      <div className="page-head">
        <div>
          <nav className="eyebrow" aria-label="Навигационна пътека">
            <Link href="/">Портфолио</Link>
            <span aria-hidden="true">/</span>
            <span>{site.timezone.replace("_", " ")}</span>
          </nav>
          <h1>{site.name}</h1>
        </div>
        <div className="head-actions">
          <OwnerLink siteId={siteId} />
          <ModeSwitch mode={mode} onSelect={select} />
          <SiteSwitcher siteId={siteId} tab={tab} />
          <LivePill connection={connection} updatedAt={site.summary.updated_at} />
        </div>
      </div>
      {connection === "reconnecting" && (
        <p className="notice" role="status">
          Връзката с API прекъсна. Показани са последните известни стойности, докато връзката се възстанови.
        </p>
      )}
      <nav className="tabs" aria-label={`Раздели на обекта ${site.name}`}>
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
