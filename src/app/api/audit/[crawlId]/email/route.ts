import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { requireClientAccess } from "@/lib/access";
import { auditPdf } from "@/lib/audit-pdf";
import { sendEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import type { CrawlDeep } from "@/lib/crawl-deep";

export const maxDuration = 60;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

  const agency = process.env.REPORT_AGENCY_NAME || "Digital Oasis";
  const deep = crawl.advanced as unknown as CrawlDeep | null;
  const score = deep?.overall ?? crawl.score ?? null;
  const date = (crawl.finishedAt ?? crawl.startedAt).toISOString().slice(0, 10);
  const color = /^#[0-9a-f]{6}$/i.test(crawl.client.brandPrimaryColor ?? "") ? crawl.client.brandPrimaryColor! : "#4f46e5";
  const note = String(body.message ?? "").trim().slice(0, 2000);
  const actions = deep?.ai?.actions.slice(0, 5) ?? [];

  try {
    const pdf = await auditPdf(crawl, crawl.client);
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;color:#1e293b">
<div style="background:${color};color:#fff;padding:24px;border-radius:10px 10px 0 0"><div style="font-size:12px;letter-spacing:1px;opacity:.85">SEO AUDIT REPORT</div><div style="font-size:24px;font-weight:bold;margin-top:4px">${esc(crawl.client.name)}</div><div style="font-size:14px;margin-top:2px">${esc(crawl.target)} · ${date}</div></div>
<div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 10px 10px">
${note ? `<p style="white-space:pre-line">${esc(note)}</p>` : `<p>Hi,</p><p>Please find attached the SEO audit for <b>${esc(crawl.target)}</b>.</p>`}
${score != null ? `<p style="font-size:15px">Overall SEO score: <b style="font-size:22px">${score}</b>/100</p>` : ""}
${deep?.ai?.summary ? `<p style="color:#475569">${esc(deep.ai.summary)}</p>` : ""}
${actions.length ? `<p style="font-weight:bold;margin-bottom:6px">Top priorities</p><ol style="padding-left:20px;margin-top:0">${actions.map((a) => `<li style="margin-bottom:6px"><b>${esc(a.title)}</b><br><span style="color:#64748b;font-size:13px">${esc(a.why)}</span></li>`).join("")}</ol>` : ""}
<p>The full report with every issue and how to fix it is attached as a PDF.</p>
<p style="color:#64748b;font-size:13px;margin-top:24px">${esc(agency)}</p></div></div>`;
    const text = `${note || `Please find attached the SEO audit for ${crawl.target}.`}\n\n${score != null ? `Overall SEO score: ${score}/100\n\n` : ""}${actions.map((a, i) => `${i + 1}. ${a.title}`).join("\n")}\n\n${agency}`;
    await sendEmail({
      to, subject: `SEO audit report: ${crawl.target} (${date})`, html, text, replyTo: user.email,
      attachments: [{ filename: `seo-audit-${crawl.client.slug}-${date}.pdf`, content: pdf }],
    });
  } catch (e) {
    console.error("Audit email failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  await db.client.update({ where: { id: crawl.clientId }, data: { reportEmails: to } });
  await logActivity({ actorId: user.id, clientId: crawl.clientId, action: "audit.email", entity: "client", entityId: crawl.clientId, after: { to, crawlId } });
  return NextResponse.json({ ok: true, to });
}
