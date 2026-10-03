import { describe, expect, it } from "vitest";
import { liveUrl, type Command } from "./api";
import { applyEvent, emptyLiveState, latestCommandByDevice, parseLiveEvent } from "./live-state";

function command(overrides: Partial<Command>): Command {
  return {
    id: "c1",
    site_id: "s1",
    device_id: "d1",
    type: "switch",
    params: { on: true },
    status: "pending",
    reason: null,
    created_at: "2026-10-03T10:00:00Z",
    expires_at: "2026-10-03T10:00:15Z",
    acknowledged_at: null,
    ...overrides,
  };
}

describe("live state", () => {
  it("never moves a command back to an earlier status", () => {
    let state = applyEvent(emptyLiveState, { type: "command", data: command({ status: "applied" }) });
    state = applyEvent(state, { type: "command", data: command({ status: "sent" }) });
    expect(state.commands.c1.status).toBe("applied");
  });

  it("lets a late acknowledgement replace an expiry", () => {
    let state = applyEvent(emptyLiveState, { type: "command", data: command({ status: "expired" }) });
    state = applyEvent(state, { type: "command", data: command({ status: "applied" }) });
    expect(state.commands.c1.status).toBe("applied");
  });

  it("picks the newest command per device", () => {
    const latest = latestCommandByDevice({
      a: command({ id: "a", created_at: "2026-10-03T10:00:00Z" }),
      b: command({ id: "b", created_at: "2026-10-03T10:05:00Z" }),
      c: command({ id: "c", device_id: "d2" }),
    });
    expect(latest.d1.id).toBe("b");
    expect(latest.d2.id).toBe("c");
  });

  it("ignores malformed socket messages", () => {
    expect(parseLiveEvent("not json")).toBeNull();
    expect(parseLiveEvent('{"type":"other","data":{}}')).toBeNull();
    expect(parseLiveEvent('{"type":"snapshot"}')).toBeNull();
    expect(parseLiveEvent('{"type":"command","data":{"id":"x"}}')?.type).toBe("command");
  });

  it("derives the WebSocket URL from the API URL", () => {
    expect(liveUrl("abc", "http://localhost:8000")).toBe("ws://localhost:8000/api/v1/sites/abc/live");
    expect(liveUrl("abc", "https://api.example.com")).toBe("wss://api.example.com/api/v1/sites/abc/live");
  });
});
