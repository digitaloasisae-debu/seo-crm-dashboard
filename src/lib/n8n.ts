import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/** Checks the bearer token (and optional IP allowlist) on /api/n8n/* requests. Returns a 401/403 response or null. */
export function checkN8nAuth(req: NextRequest): NextResponse | null {
  const token = process.env.N8N_API_TOKEN;
  if (!token) return NextResponse.json({ error: "N8N_API_TOKEN is not configured" }, { status: 500 });

  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allow = (process.env.N8N_ALLOWED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length) {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
    if (!allow.includes(ip)) return NextResponse.json({ error: `IP ${ip || "unknown"} not allowed` }, { status: 403 });
  }
  return null;
}

/** Ask n8n to run a workflow now (its Webhook trigger). */
export async function triggerN8n(which: "WF1" | "WF2", body: Record<string, unknown>) {
  const url = which === "WF1" ? process.env.N8N_WF1_WEBHOOK_URL : process.env.N8N_WF2_WEBHOOK_URL;
  if (!url) throw new Error(`${which === "WF1" ? "N8N_WF1_WEBHOOK_URL" : "N8N_WF2_WEBHOOK_URL"} is not configured`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.N8N_API_TOKEN ?? ""}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`n8n responded ${res.status}`);
}
