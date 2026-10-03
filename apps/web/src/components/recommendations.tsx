"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SparkIcon } from "@/components/icons";
import { failureText } from "@/components/poll-status";
import { usePolled } from "@/hooks/use-polled";
import { useSiteLive } from "@/hooks/use-site-live";
import { useSiteMode } from "@/hooks/use-site-mode";
import { api, type Command, type Device, type DeviceLive, type Recommendation } from "@/lib/api";
import {
  applyBlocker,
  applyRecommendation,
  describeAction,
  manualOverride,
  RECOMMENDATIONS_POLL_MS,
  statusView,
} from "@/lib/assist";
import { formatMoney, formatSiteTime } from "@/lib/format";
import { latestCommandByDevice } from "@/lib/live-state";
import type { PollState } from "@/lib/poll";

/** What "Приложи" did for one recommendation: the command it created, or why sending failed. */
export type Applied = { commandId?: string; error?: string; submitting?: boolean };

type ListProps = {
  state: PollState<Recommendation[]>;
  devices: Device[];
  live: DeviceLive[];
  commands: Record<string, Command>;
  applied: Record<string, Applied>;
  onApply: (recommendation: Recommendation) => void;
  timeZone: string;
};

function RecommendationRow({
  recommendation,
  device,
  reading,
  command,
  latestOnDevice,
  appliedIds,
  entry,
  onApply,
}: {
  recommendation: Recommendation;
  device: Device | undefined;
  reading: DeviceLive | undefined;
  command: Command | undefined;
  latestOnDevice: Command | undefined;
  appliedIds: ReadonlySet<string>;
  entry: Applied | undefined;
  onApply: (recommendation: Recommendation) => void;
}) {
  const blocker = applyBlocker(recommendation, device, reading);
  const status = statusView(command, entry?.error);
  const busy = entry?.submitting === true || (status !== null && !status.final);
  const done = command?.status === "applied";
  const override = manualOverride(command, latestOnDevice, appliedIds);
  const titleId = `rec-${recommendation.id}`;

  return (
    <li className="recommendation" aria-labelledby={titleId}>
      <span className="insight-icon" data-tone="solar" aria-hidden="true">
        <SparkIcon />
      </span>
      <div className="recommendation-body">
        <p id={titleId} className="recommendation-title">
          {recommendation.title}
        </p>
        <p className="recommendation-detail">{recommendation.detail}</p>
        <p className="recommendation-meta">
          <span>
            Команда към „{recommendation.device_name}“: <strong>{describeAction(recommendation.action)}</strong>
          </span>
          <span>
            спестява около <strong>{formatMoney(recommendation.saving_per_hour, recommendation.currency)}</strong> на час
          </span>
        </p>
        {/* Mounted while still empty: screen readers skip a live region that appears already filled. */}
        <p
          className="command-note"
          aria-live="polite"
          data-tone={status?.tone}
          data-status={status ? (command?.status ?? "error") : undefined}
        >
          {status?.text}
        </p>
        {override && (
          <p className="command-note" data-tone="busy" data-override="true">
            По-късно устройството е променено ръчно.
          </p>
        )}
        {blocker && !status && <p className="command-note" data-tone="bad">{blocker}</p>}
      </div>
      <button
        type="button"
        className="button-primary button-small"
        disabled={blocker !== null || busy || done}
        title={blocker ?? undefined}
        onClick={() => onApply(recommendation)}
      >
        {done ? "Приложено" : command?.status === "sent" ? "Изчакване…" : busy ? "Изпраща се…" : "Приложи"}
      </button>
    </li>
  );
}

/** The recommendations panel body for any poll state. Exported for tests; the overview uses Recommendations. */
export function RecommendationList({ state, devices, live, commands, applied, onApply, timeZone }: ListProps) {
  const devicesById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const liveById = useMemo(() => new Map(live.map((l) => [l.device_id, l])), [live]);
  const latest = useMemo(() => latestCommandByDevice(commands), [commands]);
  const appliedIds = useMemo(
    () => new Set(Object.values(applied).flatMap((entry) => (entry.commandId ? [entry.commandId] : []))),
    [applied],
  );

  if (state.status === "loading") return <p className="muted" aria-busy="true">Зареждане на препоръките…</p>;
  if (state.status === "failed") {
    return (
      <p className="notice" data-tone="bad" role="alert">
        Препоръките не са налични. {failureText(state.failure)} Опитваме отново автоматично.
      </p>
    );
  }
  const items = state.data;
  return (
    <>
      {state.failure && (
        <p className="notice" role="status">
          Обновяването не успя: {failureText(state.failure)} Показани са препоръките от{" "}
          {formatSiteTime(state.updatedAt, timeZone)}.
        </p>
      )}
      {items.length === 0 ? (
        <p className="muted">
          Няма препоръки в момента. Появяват се, когато има излишък от слънцето или пикова цена.
        </p>
      ) : (
        <ul className="recommendations">
          {items.map((recommendation) => {
            const entry = applied[recommendation.id];
            return (
              <RecommendationRow
                key={recommendation.id}
                recommendation={recommendation}
                device={devicesById.get(recommendation.device_id)}
                reading={liveById.get(recommendation.device_id)}
                command={entry?.commandId ? commands[entry.commandId] : undefined}
                latestOnDevice={latest[recommendation.device_id]}
                appliedIds={appliedIds}
                entry={entry}
                onApply={onApply}
              />
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Assist mode: the API's proposals, each applied only when the user presses "Приложи". */
export function Recommendations() {
  const { siteId, snapshot, commands } = useSiteLive();
  const { send } = useSiteMode();
  const state = usePolled(api.recommendations, siteId, RECOMMENDATIONS_POLL_MS);
  const [applied, setApplied] = useState<Record<string, Applied>>({});
  if (!snapshot) return null;

  async function apply(recommendation: Recommendation) {
    setApplied((current) => ({ ...current, [recommendation.id]: { submitting: true } }));
    try {
      const command = await applyRecommendation(recommendation, send);
      setApplied((current) => ({ ...current, [recommendation.id]: { commandId: command.id } }));
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : "неизвестна грешка";
      setApplied((current) => ({ ...current, [recommendation.id]: { error } }));
    }
  }

  return (
    <section className="panel span-all" aria-labelledby="assist-title">
      <div className="panel-head">
        <h2 id="assist-title">Препоръки</h2>
        <span className="muted">
          Нищо не се изпраща, докато не натиснете „Приложи“. Историята е в <Link href={`/sites/${siteId}/activity`}>Activity</Link>.
        </span>
      </div>
      <RecommendationList
        state={state}
        devices={snapshot.devices}
        live={snapshot.live}
        commands={commands}
        applied={applied}
        onApply={(recommendation) => void apply(recommendation)}
        timeZone={snapshot.site.timezone}
      />
    </section>
  );
}
