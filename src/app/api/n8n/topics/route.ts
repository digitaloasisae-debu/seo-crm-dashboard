import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkN8nAuth } from "@/lib/n8n";

// GET /api/n8n/topics?client={id}&status=approved&has_article=false&limit=10
// (replaces "Get row(s) in sheet" + "Filter & Select Keyword" in WF2)
export async function GET(req: NextRequest) {
  const denied = checkN8nAuth(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("client") ?? undefined;
  const status = (sp.get("status") ?? "approved").toUpperCase() as "APPROVED" | "GENERATED" | "REJECTED";
  const hasArticle = sp.get("has_article");
  const limit = Math.min(Number(sp.get("limit") ?? 10) || 10, 100);

  const topics = await db.topic.findMany({
    where: {
      clientId,
      status,
      client: { status: "ACTIVE" },
      ...(hasArticle === null ? {} : hasArticle === "true" ? { article: { isNot: null } } : { article: { is: null } }),
    },
    orderBy: { generatedAt: "asc" },
    take: limit,
    include: { client: { select: { id: true, name: true, slug: true } } },
  });

  return NextResponse.json(
    topics.map((t) => ({
      topic_id: t.id,
      client_id: t.client.id,
      client_name: t.client.name,
      selected_keyword: t.keyword,
      secondary_keywords: t.secondaryKeywords,
      topic: t.title,
      angle: t.angle ?? "",
      category: t.category ?? "",
    })),
  );
}
