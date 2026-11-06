import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { requireClientAccess } from "@/lib/access";
import { auditPdf } from "@/lib/audit-pdf";

export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ crawlId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { crawlId } = await params;
  const crawl = await db.siteCrawl.findUnique({ where: { id: crawlId }, include: { client: { select: { name: true, slug: true, brandPrimaryColor: true, logoUrl: true } } } });
  if (!crawl || crawl.status !== "DONE") return NextResponse.json({ error: "Audit not found or not finished" }, { status: 404 });
  try {
    await requireClientAccess(user, crawl.clientId, "view");
  } catch {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  const pdf = await auditPdf(crawl, crawl.client);
  const name = `seo-audit-${crawl.client.slug}-${(crawl.finishedAt ?? crawl.startedAt).toISOString().slice(0, 10)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
