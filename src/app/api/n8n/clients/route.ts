import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkN8nAuth } from "@/lib/n8n";
import { clientForN8n } from "../serialize";

// GET /api/n8n/clients?active=true  (replaces "Read Client Config" in WF1)
export async function GET(req: NextRequest) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const activeOnly = req.nextUrl.searchParams.get("active") !== "false";
  const clients = await db.client.findMany({
    where: activeOnly ? { status: "ACTIVE" } : {},
    orderBy: { name: "asc" },
    include: { brain: true },
  });
  return NextResponse.json(clients.map((c) => clientForN8n(c)));
}
