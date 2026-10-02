import { readBackendStatus } from "@/lib/backend-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readBackendStatus(process.env.API_URL ?? "http://127.0.0.1:8000");
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
