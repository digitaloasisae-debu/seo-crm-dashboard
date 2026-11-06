import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { requireClientAccess } from "@/lib/access";
import { fullAuditPdf } from "@/lib/full-audit-pdf";

export const maxDuration = 120;

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
  let pdf: Buffer;
  try {
    pdf = await fullAuditPdf(crawl, crawl.client);
  } catch (e) {
    console.error("Audit PDF failed:", e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}\n\n${(e.stack ?? "").split("\n").slice(1, 6).join("\n")}` : String(e);
    return new NextResponse(`The PDF couldn't be created. Please send this to support:\n\n${msg}`, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const name = `website-gbp-audit-${crawl.client.slug}-${(crawl.finishedAt ?? crawl.startedAt).toISOString().slice(0, 10)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
