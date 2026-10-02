import { afterEach, describe, expect, it, vi } from "vitest";
import { readBackendStatus } from "./backend-status";

afterEach(() => vi.unstubAllGlobals());

describe("backend status", () => {
  it("reports the actual API and database responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => Response.json(
      url.pathname.endsWith("/health") ? { status: "ok", service: "optimesh-api" } : { status: "ready" },
    )));
    expect(await readBackendStatus("http://localhost:8000")).toEqual({
      api: "online", database: "ready",
    });
  });

  it("keeps liveness separate from failed readiness", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => url.pathname.endsWith("/health")
      ? Response.json({ status: "ok", service: "optimesh-api" })
      : Response.json({ detail: "Database unavailable" }, { status: 503 })));
    expect(await readBackendStatus("http://localhost:8000")).toEqual({
      api: "online", database: "unavailable",
    });
  });

  it("handles connection failures and invalid responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection refused")));
    expect((await readBackendStatus("http://localhost:8000")).api).toBe("offline");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "ok" })));
    expect((await readBackendStatus("http://localhost:8000")).api).toBe("offline");
  });

  it("rejects unsupported URLs without making requests", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect((await readBackendStatus("file:///etc/passwd")).api).toBe("offline");
    expect(request).not.toHaveBeenCalled();
  });
});
