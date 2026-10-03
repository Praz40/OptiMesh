import { describe, expect, it, vi } from "vitest";
import type { Command, CommandRequest } from "./api";
import {
  DEFAULT_MODE,
  guardSend,
  loadMode,
  modeKey,
  modeReducer,
  parseMode,
  ReadOnlyModeError,
  saveMode,
} from "./site-mode";

const SITE = "5e000000-0000-4000-8000-000000000001";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const throwing = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
};

describe("modeReducer", () => {
  it("switches between Monitor and Assist", () => {
    expect(modeReducer("monitor", { type: "select", mode: "assist" })).toBe("assist");
    expect(modeReducer("assist", { type: "select", mode: "monitor" })).toBe("monitor");
  });

  it("never selects Autopilot on a real site", () => {
    expect(modeReducer("monitor", { type: "select", mode: "autopilot" })).toBe("monitor");
    expect(modeReducer("assist", { type: "select", mode: "autopilot" })).toBe("assist");
  });

  it("starts read-only", () => {
    expect(DEFAULT_MODE).toBe("monitor");
  });
});

describe("mode storage", () => {
  it("is per site", () => {
    const storage = memoryStorage();
    expect(saveMode(SITE, "assist", storage)).toBe(true);
    expect(storage.data.get(modeKey(SITE))).toBe("assist");
    expect(loadMode(SITE, storage)).toBe("assist");
    expect(loadMode("5e000000-0000-4000-8000-000000000002", storage)).toBe("monitor");
  });

  it("ignores unknown values and a stored Autopilot", () => {
    expect(parseMode("autopilot")).toBe("monitor");
    expect(parseMode("ASSIST")).toBe("monitor");
    expect(parseMode(null)).toBe("monitor");
    expect(loadMode(SITE, memoryStorage({ [modeKey(SITE)]: "autopilot" }))).toBe("monitor");
  });

  it("survives storage that throws or is missing", () => {
    expect(loadMode(SITE, throwing)).toBe("monitor");
    expect(saveMode(SITE, "assist", throwing)).toBe(false);
    expect(loadMode(SITE, null)).toBe("monitor");
    expect(saveMode(SITE, "assist", null)).toBe(false);
  });

  it("falls back on the server, where there is no window", () => {
    expect(loadMode(SITE)).toBe("monitor");
  });
});

describe("guardSend", () => {
  const body: CommandRequest = { type: "switch", params: { on: true } };

  it("Monitor sends nothing", async () => {
    const send = vi.fn(async () => ({}) as Command);
    await expect(guardSend("monitor", send)("device", body)).rejects.toBeInstanceOf(ReadOnlyModeError);
    await expect(guardSend("autopilot", send)("device", body)).rejects.toBeInstanceOf(ReadOnlyModeError);
    expect(send).not.toHaveBeenCalled();
  });

  it("Assist passes the command through unchanged", async () => {
    const send = vi.fn(async () => ({ id: "c1" }) as Command);
    await expect(guardSend("assist", send)("device", body)).resolves.toEqual({ id: "c1" });
    expect(send).toHaveBeenCalledExactlyOnceWith("device", body);
  });
});
