import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { requireClientAccess } from "@/lib/access";
import { sendAuditEmail } from "@/lib/audit-email";
import { logActivity } from "@/lib/activity";

export const maxDuration = 60;

/** Emails the audit PDF (plus a short summary in the body) to one or more addresses. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ crawlId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
  const { crawlId } = await params;
  const crawl = await db.siteCrawl.findUnique({ where: { id: crawlId }, include: { client: { select: { id: true, name: true, slug: true, brandPrimaryColor: true, logoUrl: true } } } });
  if (!crawl || crawl.status !== "DONE") return NextResponse.json({ error: "Audit not found or not finished" }, { status: 404 });
  try {
    await requireClientAccess(user, crawl.clientId, "edit");
  } catch {
    return NextResponse.json({ error: "You don't have edit access to this client" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { to?: string; message?: string };
  const to = [...new Set(String(body.to ?? "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const bad = to.filter((x) => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x));
  if (!to.length) return NextResponse.json({ error: "Add at least one email address" }, { status: 400 });
  if (bad.length) return NextResponse.json({ error: `Not a valid email: ${bad.join(", ")}` }, { status: 400 });
  if (to.length > 10) return NextResponse.json({ error: "Up to 10 recipients at a time" }, { status: 400 });

  try {
    await sendAuditEmail(crawl.id, to, { note: String(body.message ?? ""), replyTo: user.email ?? undefined });
  } catch (e) {
    console.error("Audit email failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  await db.client.update({ where: { id: crawl.clientId }, data: { reportEmails: to } });
  await logActivity({ actorId: user.id, clientId: crawl.clientId, action: "audit.email", entity: "client", entityId: crawl.clientId, after: { to, crawlId } });
  return NextResponse.json({ ok: true, to });
}
