import { ApiError } from "./api";

/** Why a request failed: the API could not be reached at all, or it answered with an error. */
export type PollFailure = { kind: "offline" } | { kind: "error"; status: number; message: string };

export type PollState<T> =
  | { status: "loading" }
  /** `failure` is set when a later refresh failed; `data` is then the last good response. */
  | { status: "ready"; data: T; updatedAt: number; failure: PollFailure | null }
  | { status: "failed"; failure: PollFailure };

export type PollEvent<T> = { type: "success"; data: T; at: number } | { type: "failure"; failure: PollFailure };

export const LOADING: PollState<never> = { status: "loading" };

export function pollFailure(error: unknown): PollFailure {
  if (error instanceof ApiError) return { kind: "error", status: error.status, message: error.message };
  // fetch rejects with a TypeError when the server cannot be reached.
  return { kind: "offline" };
}

/** Keeps the last good data when a refresh fails, so a short outage does not blank the screen. */
export function pollReducer<T>(state: PollState<T>, event: PollEvent<T>): PollState<T> {
  if (event.type === "success") return { status: "ready", data: event.data, updatedAt: event.at, failure: null };
  if (state.status === "ready") return { ...state, failure: event.failure };
  return { status: "failed", failure: event.failure };
}

/**
 * Loads now and then every `intervalMs`, or after `retryMs` while failing. Returns a stop
 * function that aborts the request in flight and cancels the next one.
 */
export function startPolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  { intervalMs, retryMs = Math.min(intervalMs, 15_000) }: { intervalMs: number; retryMs?: number },
  onEvent: (event: PollEvent<T>) => void,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick() {
    let delay = intervalMs;
    try {
      const data = await load(controller.signal);
      if (controller.signal.aborted) return;
      onEvent({ type: "success", data, at: Date.now() });
    } catch (error) {
      if (controller.signal.aborted) return;
      onEvent({ type: "failure", failure: pollFailure(error) });
      delay = retryMs;
    }
    if (!controller.signal.aborted) timer = setTimeout(tick, delay);
  }

  void tick();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
