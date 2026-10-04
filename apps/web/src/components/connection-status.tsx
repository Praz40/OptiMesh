"use client";

import { useEffect, useState } from "react";
import type { BackendStatus } from "@/lib/backend-status";

const STATE_LABELS: Record<BackendStatus["api"] | BackendStatus["database"], string> = {
  online: "Работи",
  offline: "Недостъпно",
  ready: "Готова",
  unavailable: "Недостъпна",
};

async function requestStatus(signal?: AbortSignal): Promise<BackendStatus> {
  try {
    const response = await fetch("/api/status", { cache: "no-store", signal });
    if (!response.ok) throw new Error("Status request failed");
    return (await response.json()) as BackendStatus;
  } catch {
    return { api: "offline", database: "unavailable" };
  }
}

export function ConnectionStatus() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void requestStatus(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setStatus(result);
        setChecking(false);
      }
    });
    return () => controller.abort();
  }, []);

  async function recheck() {
    setChecking(true);
    setStatus(await requestStatus());
    setChecking(false);
  }

  return (
    <section className="connection" aria-labelledby="connection-title">
      <div className="section-heading">
        <h2 id="connection-title">Връзки</h2>
        <button type="button" onClick={() => void recheck()} disabled={checking}>
          {checking ? "Проверка…" : "Провери връзката"}
        </button>
      </div>
      <dl aria-live="polite">
        <div><dt>API на бекенда</dt><dd data-state={status?.api}>{status ? STATE_LABELS[status.api] : "Проверка"}</dd></div>
        <div><dt>PostgreSQL</dt><dd data-state={status?.database}>{status ? STATE_LABELS[status.database] : "Проверка"}</dd></div>
      </dl>
      <p>Стартирайте API, за да се свържете. PostgreSQL е готова, след като се зададе DATABASE_URL.</p>
    </section>
  );
}
