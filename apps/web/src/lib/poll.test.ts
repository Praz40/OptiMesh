import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { LOADING, pollFailure, pollReducer, startPolling, type PollEvent, type PollState } from "./poll";

describe("pollFailure", () => {
  it("tells an unreachable API from an API error", () => {
    expect(pollFailure(new TypeError("Failed to fetch"))).toEqual({ kind: "offline" });
    expect(pollFailure(new ApiError(503, "Database unavailable"))).toEqual({
      kind: "error",
      status: 503,
      message: "Database unavailable",
    });
  });
});

describe("pollReducer", () => {
  const offline = { type: "failure", failure: { kind: "offline" } } as const;

  it("goes from loading to ready, or to failed", () => {
    expect(pollReducer<number>(LOADING, { type: "success", data: 1, at: 5 })).toEqual({
      status: "ready",
      data: 1,
      updatedAt: 5,
      failure: null,
    });
    expect(pollReducer<number>(LOADING, offline)).toEqual({ status: "failed", failure: { kind: "offline" } });
  });

  it("keeps the last data when a refresh fails, and clears the failure on the next success", () => {
    const ready: PollState<number> = { status: "ready", data: 1, updatedAt: 5, failure: null };
    const stale = pollReducer(ready, offline);
    expect(stale).toEqual({ ...ready, failure: { kind: "offline" } });
    expect(pollReducer(stale, { type: "success", data: 2, at: 9 })).toEqual({
      status: "ready",
      data: 2,
      updatedAt: 9,
      failure: null,
    });
  });
});

describe("startPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads at once, then every interval", async () => {
    const load = vi.fn(async () => "data");
    const events: PollEvent<string>[] = [];
    const stop = startPolling(load, { intervalMs: 30_000 }, (event) => events.push(event));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual(["success", "success"]);
    stop();
  });

  it("retries sooner after a failure", async () => {
    const load = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const events: PollEvent<string>[] = [];
    const stop = startPolling(load, { intervalMs: 300_000 }, (event) => events.push(event));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(events[0]).toEqual({ type: "failure", failure: { kind: "offline" } });
    stop();
  });

  it("stops: aborts the request in flight and schedules nothing more", async () => {
    let signal: AbortSignal | undefined;
    let finish: (value: string) => void = () => undefined;
    const load = vi.fn(
      (s: AbortSignal) =>
        new Promise<string>((resolve) => {
          signal = s;
          finish = resolve;
        }),
    );
    const onEvent = vi.fn();
    const stop = startPolling(load, { intervalMs: 1000 }, onEvent);
    stop();
    expect(signal?.aborted).toBe(true);
    finish("late");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onEvent).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
