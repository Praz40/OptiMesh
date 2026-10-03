"use client";

import { useMemo } from "react";
import { CommandLog, sortedCommands } from "@/components/command-log";
import { useSiteLive } from "@/hooks/use-site-live";

export function SiteActivity() {
  const { snapshot, commands } = useSiteLive();
  const all = useMemo(() => sortedCommands(commands), [commands]);
  if (!snapshot) return null;
  const applied = all.filter((command) => command.status === "applied").length;
  const failed = all.filter((command) => ["rejected", "expired", "failed"].includes(command.status)).length;

  return (
    <section className="panel" aria-labelledby="activity-title">
      <div className="panel-head">
        <h2 id="activity-title">Command history</h2>
        <span className="muted">
          {all.length} recent · {applied} applied · {failed} not applied
        </span>
      </div>
      <p className="footnote" style={{ marginTop: 0, marginBottom: 12 }}>
        Every command is checked against the device&apos;s capabilities and limits before it is sent. “Applied” means
        the device confirmed it; “No response” means it never acknowledged within 15 s.
      </p>
      <CommandLog commands={all} devices={snapshot.devices} />
    </section>
  );
}
