"use client";

import { useEffect, useState } from "react";
import type { BackendStatus } from "@/lib/backend-status";

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
        <h2 id="connection-title">Connections</h2>
        <button type="button" onClick={() => void recheck()} disabled={checking}>
          {checking ? "Checking…" : "Check connection"}
        </button>
      </div>
      <dl aria-live="polite">
        <div><dt>Backend API</dt><dd data-state={status?.api}>{status?.api ?? "Checking"}</dd></div>
        <div><dt>PostgreSQL</dt><dd data-state={status?.database}>{status?.database ?? "Checking"}</dd></div>
      </dl>
      <p>Start the API to connect. PostgreSQL becomes ready after DATABASE_URL is configured.</p>
    </section>
  );
}
