/** Builds and sends the audit report email (summary in the body, full PDF attached). */
import { db } from "./db";
import { auditPdf } from "./audit-pdf";
import { sendEmail } from "./email";
import { getAgency } from "./report-brand";
import type { CrawlDeep } from "./crawl-deep";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendAuditEmail(crawlId: string, to: string[], opts: { note?: string; replyTo?: string; scheduled?: boolean } = {}) {
  const crawl = await db.siteCrawl.findUniqueOrThrow({ where: { id: crawlId }, include: { client: { select: { id: true, name: true, slug: true, brandPrimaryColor: true, logoUrl: true } } } });
  const agency = await getAgency();
  const deep = crawl.advanced as unknown as CrawlDeep | null;
  const score = deep?.overall ?? crawl.score ?? null;
  const date = (crawl.finishedAt ?? crawl.startedAt).toISOString().slice(0, 10);
  const color = /^#[0-9a-f]{6}$/i.test(crawl.client.brandPrimaryColor ?? "") ? crawl.client.brandPrimaryColor! : "#4f46e5";
  const note = (opts.note ?? "").trim().slice(0, 2000);
  const actions = deep?.ai?.actions.slice(0, 5) ?? [];
  const prev = await db.siteCrawl.findFirst({ where: { clientId: crawl.clientId, status: "DONE", startedAt: { lt: crawl.startedAt } }, orderBy: { startedAt: "desc" }, select: { score: true, advanced: true } });
  const prevScore = (prev?.advanced as unknown as CrawlDeep | null)?.overall ?? prev?.score ?? null;
  const delta = score != null && prevScore != null ? score - prevScore : null;
  const intro = note
    ? `<p style="white-space:pre-line">${esc(note)}</p>`
    : opts.scheduled
      ? `<p>Hi,</p><p>Here is this month's SEO audit for <b>${esc(crawl.target)}</b>.</p>`
      : `<p>Hi,</p><p>Please find attached the SEO audit for <b>${esc(crawl.target)}</b>.</p>`;

  const pdf = await auditPdf(crawl, crawl.client);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;color:#1e293b">
<div style="background:${color};color:#fff;padding:24px;border-radius:10px 10px 0 0"><div style="font-size:12px;letter-spacing:1px;opacity:.85">${opts.scheduled ? "MONTHLY " : ""}SEO AUDIT REPORT</div><div style="font-size:24px;font-weight:bold;margin-top:4px">${esc(crawl.client.name)}</div><div style="font-size:14px;margin-top:2px">${esc(crawl.target)} · ${date}</div></div>
<div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 10px 10px">
${intro}
${score != null ? `<p style="font-size:15px">Overall SEO score: <b style="font-size:22px">${score}</b>/100${delta ? ` <span style="color:${delta > 0 ? "#059669" : "#dc2626"}">(${delta > 0 ? "+" : ""}${delta} since the last audit)</span>` : ""}</p>` : ""}
${deep?.ai?.summary ? `<p style="color:#475569">${esc(deep.ai.summary)}</p>` : ""}
${actions.length ? `<p style="font-weight:bold;margin-bottom:6px">Top priorities</p><ol style="padding-left:20px;margin-top:0">${actions.map((a) => `<li style="margin-bottom:6px"><b>${esc(a.title)}</b><br><span style="color:#64748b;font-size:13px">${esc(a.why)}</span></li>`).join("")}</ol>` : ""}
<p>The full report with every issue and how to fix it is attached as a PDF.</p>
<p style="color:#64748b;font-size:13px;margin-top:24px">${esc(agency.name)}${agency.website ? `<br><a href="${esc(agency.website)}" style="color:#64748b">${esc(agency.website.replace(/^https?:\/\//, ""))}</a>` : ""}</p></div></div>`;
  const text = `${note || `Please find attached the SEO audit for ${crawl.target}.`}\n\n${score != null ? `Overall SEO score: ${score}/100\n\n` : ""}${actions.map((a, i) => `${i + 1}. ${a.title}`).join("\n")}\n\n${agency.name}`;
  await sendEmail({
    to, subject: `${opts.scheduled ? "Monthly " : ""}SEO audit report: ${crawl.target} (${date})`, html, text, replyTo: opts.replyTo || agency.email || undefined,
    attachments: [{ filename: `seo-audit-${crawl.client.slug}-${date}.pdf`, content: pdf }],
  });
}
