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
        <h2 id="activity-title">История на командите</h2>
        <span className="muted">
          {all.length} последни · {applied} приложени · {failed} неприложени
        </span>
      </div>
      <p className="footnote" style={{ marginTop: 0, marginBottom: 12 }}>
        Всяка команда се проверява спрямо възможностите и границите на устройството, преди да бъде изпратена.
        „Приложено“ значи, че устройството я е потвърдило; „Няма отговор“ значи, че не я е потвърдило до 15 секунди.
      </p>
      <CommandLog commands={all} devices={snapshot.devices} />
    </section>
  );
}
