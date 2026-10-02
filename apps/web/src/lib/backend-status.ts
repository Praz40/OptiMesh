export type BackendStatus = {
  api: "online" | "offline";
  database: "ready" | "unavailable";
};

async function probe(url: URL, expected: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return false;
    return Object.entries(expected).every(
      ([key, value]) => (body as Record<string, unknown>)[key] === value,
    );
  } catch {
    return false;
  }
}

export async function readBackendStatus(baseUrl: string): Promise<BackendStatus> {
  try {
    const base = new URL(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    if (!["http:", "https:"].includes(base.protocol)) throw new Error("Unsupported API URL");
    const [api, database] = await Promise.all([
      probe(new URL("health", base), { status: "ok", service: "optimesh-api" }),
      probe(new URL("ready", base), { status: "ready" }),
    ]);
    return { api: api ? "online" : "offline", database: database ? "ready" : "unavailable" };
  } catch {
    return { api: "offline", database: "unavailable" };
  }
}
