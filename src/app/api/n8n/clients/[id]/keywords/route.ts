import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { addKeywords } from "@/lib/intake";
import { checkN8nAuth } from "@/lib/n8n";

// GET /api/n8n/clients/{id}/keywords?status=approved&used=false&limit=25
// (replaces "Read Keyword Pool" + "Select Top 10 Unused Approved" in WF1)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const status = (sp.get("status") ?? "approved").toUpperCase() as "APPROVED" | "PENDING" | "REJECTED";
  const used = sp.get("used");
  const limit = Math.min(Number(sp.get("limit") ?? 25) || 25, 200);

  const keywords = await db.keyword.findMany({
    where: { clientId: id, status, ...(used === null ? {} : { used: used === "true" }) },
    orderBy: { addedAt: "asc" },
    take: limit,
  });
  return NextResponse.json(
    keywords.map((k) => ({ id: k.id, keyword: k.keyword, category: k.category ?? "", search_volume: k.searchVolume, difficulty: k.difficulty, date_added: k.addedAt })),
  );
}

// POST /api/n8n/clients/{id}/keywords  { keywords: string[], category? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const body = z.object({ keywords: z.array(z.string()).min(1), category: z.string().optional() }).safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  await addKeywords(id, body.data.keywords, { source: "API", actorTag: "n8n", category: body.data.category });
  return NextResponse.json({ ok: true });
}
