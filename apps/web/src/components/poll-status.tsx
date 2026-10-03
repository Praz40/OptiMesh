import { AlertIcon } from "@/components/icons";
import { formatSiteTime } from "@/lib/format";
import type { PollFailure } from "@/lib/poll";

/** One Bulgarian sentence for a failed request. */
export function failureText(failure: PollFailure): string {
  if (failure.kind === "offline") return "Няма връзка с OptiMesh API.";
  if (failure.status === 404) return "Обектът не е намерен.";
  if (failure.status === 503) return "API няма връзка с базата данни.";
  return `API върна грешка ${failure.status}.`;
}

/** Shown instead of a screen until its first response arrives, or when that request failed. */
export function PollPending({ failure, loadingText }: { failure: PollFailure | null; loadingText: string }) {
  if (!failure) {
    return (
      <section className="empty-state" aria-busy="true">
        <p>{loadingText}</p>
      </section>
    );
  }
  return (
    <section className="empty-state" role="alert" data-failure={failure.kind}>
      <h2>{failure.kind === "offline" ? "Няма връзка с API" : "Данните не са налични"}</h2>
      <p>
        {failureText(failure)}{" "}
        {failure.kind === "error" && failure.status === 404 ? "" : "Опитваме отново автоматично."}
      </p>
    </section>
  );
}

/** A refresh failed after data had loaded: keep showing it, and say how old it is. */
export function StaleNotice({ failure, updatedAt, timeZone }: { failure: PollFailure; updatedAt: number; timeZone: string }) {
  return (
    <p className="notice" role="status">
      <AlertIcon />
      <span>
        Обновяването не успя: {failureText(failure)} Показани са данните от {formatSiteTime(updatedAt, timeZone)}.
        Опитваме отново автоматично.
      </span>
    </p>
  );
}

/** The API's own list of assumptions, shown verbatim (it is Bulgarian already). */
export function AssumptionList({ id, items }: { id: string; items: string[] }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>Допускания</h2>
        <span className="muted">как са получени числата</span>
      </div>
      {items.length === 0 ? (
        <p className="muted">API не е посочило допускания.</p>
      ) : (
        <ul className="assumptions">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
