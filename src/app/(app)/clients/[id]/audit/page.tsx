import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { AuditBoard } from "@/components/audit-board";
import { SubmitButton } from "@/components/submit-button";
import { RefreshWhile } from "@/components/refresh-while";
import { Spinner } from "@/components/spinner";
import { fmtDate } from "@/lib/utils";
import { dataforseoConfigured } from "@/lib/dataforseo";
import { compareIssues, pollCrawl, type CrawlIssue } from "@/lib/crawl";
import { after } from "next/server";
import { fixIssueAction, rerunDeepAction, saveAuditSettingsAction, startCrawlAction } from "./actions";
import { claimDeep, DEEP_VERSION, runDeepSafe, type CrawlDeep } from "@/lib/crawl-deep";
import { DeepAudit } from "@/components/deep-audit";
import { EmailReport } from "@/components/email-report";
import { emailConfigured } from "@/lib/email";
import { geminiConfigured } from "@/lib/gemini";
import type { CrawlFix } from "@/lib/crawl-fix";

export const maxDuration = 300;

const DOMAIN_CHECKS: Record<string, string> = {
  ssl: "SSL certificate",
  sitemap: "XML sitemap",
  robots_txt: "robots.txt",
  http2: "HTTP/2",
  test_https_redirect: "HTTP → HTTPS redirect",
  test_www_redirect: "www / non-www redirect",
  test_canonicalization: "Home page canonicalisation",
  test_page_not_found: "Real 404 page",
  test_directory_browsing: "Directory browsing off",
  test_hidden_server_signature: "Server signature hidden",
};
/** Checks where true means a problem. */
const DOMAIN_BAD = new Set(["start_page_deny_flag", "test_directory_browsing"]);

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; open?: string; saved?: string }> }) {
  const { id } = await params;
  const { err, open, saved } = await searchParams;
  const user = await requireUser();
  const [editable, crawls] = await Promise.all([canEdit(user, id), db.siteCrawl.findMany({ where: { clientId: id }, orderBy: { startedAt: "desc" }, take: 10 })]);
  let current = crawls[0] ?? null;
  if (current?.status === "RUNNING") current = await pollCrawl(current);
  const done = current?.status === "DONE" ? current : crawls.find((c) => c.status === "DONE") ?? null;
  const issues = (done?.issues as unknown as CrawlIssue[] | null) ?? [];
  const domain = (done?.domainInfo ?? {}) as Record<string, unknown> & { checks?: Record<string, boolean> };
  const metrics = (done?.metrics ?? {}) as Record<string, number>;
  const ready = dataforseoConfigured();
  const fixes = (done?.aiFixes ?? {}) as Record<string, CrawlFix>;
  // The deep analysis starts by itself the first time a finished audit is opened, and is rebuilt
  // (with the issue list) once when the report was made by an older version of the audit.
  const oldDeep = done?.advanced as unknown as CrawlDeep | null;
  if (done && !done.advancedAt && (await claimDeep(done.id))) {
    const crawlId = done.id;
    after(() => runDeepSafe(crawlId));
    done.advancedStartedAt = new Date();
  } else if (done && oldDeep && done.advancedAt && !done.advancedError && (oldDeep.version ?? 1) < DEEP_VERSION && (await claimDeep(done.id, true))) {
    const crawlId = done.id;
    after(() => runDeepSafe(crawlId, true));
    done.advancedAt = null;
    done.advancedStartedAt = new Date();
  }
  const deep = oldDeep;
  const prev = done ? crawls.find((c) => c.status === "DONE" && c.id !== done.id && c.startedAt < done.startedAt) ?? null : null;
  const diff = prev ? compareIssues((prev.issues as unknown as CrawlIssue[] | null) ?? [], issues) : null;
  const prevOverall = (prev?.advanced as unknown as CrawlDeep | null)?.overall ?? null;
  const clientInfo = await db.client.findUnique({ where: { id }, select: { reportEmails: true, submittedBy: true, auditSchedule: true, auditNextAt: true, auditAutoEmail: true, auditJsRender: true } });
  const trend = crawls.filter((c) => c.status === "DONE").slice(0, 12).reverse().map((c) => ({ date: c.finishedAt ?? c.startedAt, score: c.score, overall: (c.advanced as unknown as CrawlDeep | null)?.overall ?? null }));
  const defaultNext = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1); return d.toISOString().slice(0, 10); })();
  const reportTo = clientInfo?.reportEmails.length ? clientInfo.reportEmails.join(", ") : /@/.test(clientInfo?.submittedBy ?? "") ? clientInfo!.submittedBy! : "";
  const deepRunning = !!done && !done.advancedAt && !!done.advancedStartedAt && Date.now() - done.advancedStartedAt.getTime() < 6 * 60_000;
  const ai = geminiConfigured();

  const issueDetail = (i: CrawlIssue) => (
                  <div className="space-y-4 text-sm">
                    {i.hint && <div><div className="mb-1 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">Why it matters</div><p className="text-slate-700">{i.hint}</p></div>}
                    {i.links && i.links.length > 0 && (
                      <div className="text-xs">
                        <div className="mb-1 font-medium text-slate-600">Page → broken link</div>
                        <ul className="space-y-0.5">{i.links.map((l, k) => <li key={k} className="flex min-w-0 gap-1.5"><a className="max-w-[45%] truncate text-indigo-600 hover:underline" href={l.from} target="_blank" rel="noreferrer">{l.from.replace(/^https?:\/\/[^/]+/, "") || "/"}</a><span className="text-slate-400">→</span><span className="min-w-0 flex-1 truncate text-red-700">{l.to}</span>{l.status ? <span className="text-slate-400">{l.status}</span> : null}</li>)}</ul>
                      </div>
                    )}
                    {i.groups && i.groups.length > 0 && (
                      <div className="space-y-1.5 text-xs">
                        {i.groups.map((g, k) => <div key={k}><div className="font-medium">&ldquo;{g.value || "(empty)"}&rdquo; <span className="text-slate-400">· {g.urls.length} pages</span></div><ul className="pl-3">{g.urls.map((u) => <li key={u} className="truncate"><a className="text-indigo-600 hover:underline" href={u} target="_blank" rel="noreferrer">{u}</a></li>)}</ul></div>)}
                      </div>
                    )}
                    {i.urls.length > 0 && !i.links?.length && !i.groups?.length && (
                      <ul className="space-y-0.5 text-xs">
                        {i.urls.map((u) => <li key={u} className="truncate"><a className="text-indigo-600 hover:underline" href={u} target="_blank" rel="noreferrer">{u}</a></li>)}
                        {i.count > i.urls.length && <li className="text-slate-400">…and {(i.count - i.urls.length).toLocaleString()} more</li>}
                      </ul>
                    )}
                    {fixes[i.code] ? (
                      <div className="space-y-2 rounded-xl bg-violet-50/60 p-3 ring-1 ring-violet-100">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-violet-800">✨ How to fix it</span>{fixes[i.code].effort && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">⏱ {fixes[i.code].effort}</span>}</div>
                        {fixes[i.code].summary && <p>{fixes[i.code].summary}</p>}
                        {fixes[i.code].why && <p className="text-xs text-slate-600"><b>Why it matters:</b> {fixes[i.code].why}</p>}
                        {fixes[i.code].steps.length > 0 && <ol className="list-decimal space-y-1 pl-5">{fixes[i.code].steps.map((st, k) => <li key={k}>{st.replace(/^\s*\d+[.)]\s*/, "")}</li>)}</ol>}
                        {fixes[i.code].pages.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <div className="text-xs font-semibold text-slate-600">Ready-to-paste fixes for these pages</div>
                            {fixes[i.code].pages.map((pg) => (
                              <div key={pg.url} className="rounded-lg bg-white p-2.5 text-xs ring-1 ring-slate-200">
                                <a href={pg.url} target="_blank" rel="noreferrer" className="block truncate font-medium text-indigo-600 hover:underline">{pg.url}</a>
                                {pg.current && <div className="mt-1 text-slate-500"><span className="font-semibold">Now:</span> {pg.current}</div>}
                                <div className="mt-1 whitespace-pre-line text-slate-900"><span className="font-semibold text-emerald-700">Use:</span> {pg.suggested}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {editable && ai && <form action={fixIssueAction.bind(null, id, done!.id, i.code)}><SubmitButton className="text-xs text-violet-700 hover:underline">↻ Write a new fix</SubmitButton></form>}
                      </div>
                    ) : editable && ai ? (
                      <form action={fixIssueAction.bind(null, id, done!.id, i.code)}><SubmitButton className="btn-secondary text-xs">✨ Get AI fix</SubmitButton></form>
                    ) : null}
                  </div>
  );

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Full technical audit</h2>
          <p className="text-sm text-slate-500">Crawls the whole site (up to {current?.maxPages ?? (Number(process.env.DATAFORSEO_AUDIT_MAX_PAGES) || 500)} pages) and runs 60+ checks on every page: errors, redirects, duplicates, speed, indexing, schema and more.</p>
          {err && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{err.startsWith("AI fix") || err.startsWith("Settings") ? err : <>Couldn&apos;t start: {err}</>}</p>}
          {clientInfo?.auditSchedule === "monthly" && clientInfo.auditNextAt && <p className="mt-1 text-xs text-indigo-700">🗓️ Next automatic audit: {fmtDate(clientInfo.auditNextAt)}{clientInfo.auditAutoEmail && clientInfo.reportEmails.length ? `, emailed to ${clientInfo.reportEmails.join(", ")}` : ""}</p>}
          {!ready && <p className="mt-2 text-xs text-slate-500">Needs the DataForSEO login in Vercel.</p>}
        </div>
        {editable && ready && current?.status !== "RUNNING" && (
          <form action={startCrawlAction.bind(null, id)}><SubmitButton className="btn-primary">{done ? "🔄 Run a new full audit" : "🩺 Run full audit"}</SubmitButton></form>
        )}
      </section>

      {current?.status === "RUNNING" && (
        <section className="card space-y-3">
          <RefreshWhile ms={15000} />
          <div className="flex items-center gap-3 text-sm"><Spinner className="h-5 w-5 text-indigo-600" /><span className="font-semibold">Crawling {current.target}…</span><span className="text-slate-500">{current.pagesCrawled} pages crawled{current.pagesInQueue ? `, ${current.pagesInQueue} in queue` : ""}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${Math.min(100, Math.max(3, (current.pagesCrawled / Math.max(1, Math.min(current.maxPages, current.pagesCrawled + current.pagesInQueue))) * 100))}%` }} /></div>
          <p className="text-xs text-slate-500">Small sites take a few minutes, big ones up to an hour. You can leave this page; it keeps running.</p>
          {current.error && <p className="text-xs text-amber-700">Last check: {current.error}</p>}
        </section>
      )}
      {current?.status === "FAILED" && <p className="card text-sm text-red-700">The last audit failed: {current.error}</p>}

      {done && (
        <>
          <AuditBoard
            score={done.score ?? 0}
            pages={done.pagesCrawled}
            date={fmtDate(done.finishedAt)}
            cats={deep?.categories.map((c) => ({ label: c.label, score: c.score })) ?? []}
            initialOpen={open}
            issues={issues.map((i) => ({ code: i.code, severity: i.severity, title: i.title, hint: i.hint, count: i.count, aiReady: !!fixes[i.code], isNew: !!diff?.added.some((x) => x.code === i.code) }))}
            details={Object.fromEntries(issues.map((i) => [i.code, issueDetail(i)]))}
            checks={
              <>
                <div className="mb-2 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">Site-wide checks</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(DOMAIN_CHECKS).filter(([k]) => domain.checks && k in domain.checks).map(([k, label]) => {
                  const ok = DOMAIN_BAD.has(k) ? !domain.checks![k] : !!domain.checks![k];
                  return <span key={k} className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{ok ? "✓" : "✕"} {label}</span>;
                })}
                {domain.checks?.start_page_deny_flag && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700 ring-1 ring-red-200 ring-inset">✕ Home page blocked for crawlers</span>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 ">
                {domain.cms ? <span>CMS: {String(domain.cms)}</span> : null}
                {domain.server ? <span>Server: {String(domain.server)}</span> : null}
                {metrics.links_internal != null && <span>Internal links: {metrics.links_internal.toLocaleString()}</span>}
                {metrics.links_external != null && <span>External links: {metrics.links_external.toLocaleString()}</span>}
                {metrics.broken_links != null && <span className={metrics.broken_links ? "text-red-600" : ""}>Broken links: {metrics.broken_links}</span>}
                {metrics.duplicate_title != null && <span>Duplicate titles: {metrics.duplicate_title}</span>}
                {metrics.duplicate_content != null && <span>Duplicate content: {metrics.duplicate_content}</span>}
                {metrics.non_indexable != null && <span>Not indexable: {metrics.non_indexable}</span>}
              </div>
              </>
            }
          />

          <section className="card flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Deep analysis and report</h2>
              <p className="text-sm text-slate-500">Speed, Google visibility, internal links, content, authority and competitors, AI search and an action plan. The full audit PDF also includes the <a href={`/clients/${id}/gbp`} className="text-indigo-600 hover:underline">Google profile</a> audit{done.advancedAt && deep ? `, from ${fmtDate(done.advancedAt)}` : ""}.</p>
              {done.advancedError && <p className="mt-1 text-xs text-red-700">{done.advancedError}</p>}
            </div>
            {deepRunning ? (
              <span className="flex items-center gap-2 text-sm text-indigo-700"><RefreshWhile ms={8000} /><Spinner className="h-4 w-4" />Analysing… about 1–2 minutes</span>
            ) : (
              <>
                {deep && <a href={`/api/audit/${done.id}/full-pdf`} className="btn-primary">📄 Full audit PDF (website + Google profile)</a>}
                {deep && <a href={`/api/audit/${done.id}/pdf`} className="btn-secondary">Technical PDF</a>}
                <a href={`/api/audit/${done.id}/csv`} className="btn-secondary">⬇️ CSV</a>
                {editable && <form action={rerunDeepAction.bind(null, id, done.id)}><SubmitButton className="btn-secondary">🔄 Re-run analysis</SubmitButton></form>}
                {deep && editable && <EmailReport crawlId={done.id} defaultTo={reportTo} configured={emailConfigured()} />}
              </>
            )}
          </section>

          {prev && diff && (
            <section className="card space-y-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="font-semibold">📈 Since the last audit</h2>
                <span className="text-xs text-slate-500">compared with {fmtDate(prev.finishedAt ?? prev.startedAt)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Delta label="Site health" from={prev.score} to={done.score} />
                {deep && prevOverall != null && <Delta label="Overall score" from={prevOverall} to={deep.overall} />}
                <Delta label="Pages crawled" from={prev.pagesCrawled} to={done.pagesCrawled} neutral />
                <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-800 ring-1 ring-emerald-200 ring-inset">✓ {diff.fixed.length} fixed</span>
                <span className="rounded-lg bg-red-50 px-2.5 py-1 text-red-700 ring-1 ring-red-200 ring-inset">＋ {diff.added.length} new</span>
                <span className="rounded-lg bg-slate-50 px-2.5 py-1 text-slate-700 ring-1 ring-slate-200 ring-inset">↑ {diff.worse.length} worse · ↓ {diff.better.length} better</span>
              </div>
              {(diff.fixed.length > 0 || diff.added.length > 0 || diff.worse.length > 0) && (
                <div className="grid gap-3 text-xs md:grid-cols-3">
                  <ChangeList title="Fixed" items={diff.fixed} tone="text-emerald-700" />
                  <ChangeList title="New problems" items={diff.added} tone="text-red-700" />
                  <ChangeList title="Got worse" items={diff.worse} tone="text-amber-700" />
                </div>
              )}
            </section>
          )}

          {deep && <DeepAudit d={deep} />}

        </>
      )}

      {editable && clientInfo && (
        <section id="audit-settings" className="card scroll-mt-4">
          <h2 className="font-semibold">⚙️ Audit settings</h2>
          {saved && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">Saved.</p>}
          <form action={saveAuditSettingsAction.bind(null, id)} className="mt-3 grid gap-4 text-sm md:grid-cols-2">
            <label className="space-y-1"><span className="font-medium">Automatic audits</span>
              <select name="schedule" defaultValue={clientInfo.auditSchedule} className="input w-full"><option value="off">Off (only when you click Run)</option><option value="monthly">Every month</option></select>
            </label>
            <label className="space-y-1"><span className="font-medium">Next automatic audit on</span>
              <input type="date" name="next" defaultValue={(clientInfo.auditNextAt ?? new Date(defaultNext)).toISOString().slice(0, 10)} className="input w-full" />
            </label>
            <label className="space-y-1 md:col-span-2"><span className="font-medium">Send the report to</span>
              <input name="emails" defaultValue={clientInfo.reportEmails.join(", ")} placeholder="client@example.com, manager@example.com" className="input w-full" />
              <span className="block text-xs text-slate-500">Separate several addresses with commas. Also used to pre-fill &ldquo;Email report&rdquo;.</span>
            </label>
            <label className="flex items-start gap-2"><input type="checkbox" name="autoEmail" defaultChecked={clientInfo.auditAutoEmail} className="mt-1" /><span><span className="font-medium">Email the PDF automatically</span><span className="block text-xs text-slate-500">When a monthly audit finishes, the client gets the report with the score change and top priorities.</span></span></label>
            <label className="flex items-start gap-2"><input type="checkbox" name="js" defaultChecked={clientInfo.auditJsRender} className="mt-1" /><span><span className="font-medium">Render JavaScript</span><span className="block text-xs text-slate-500">Turn on for Elementor, Divi, Wix or other sites where content loads late and the audit shows empty pages. Costs about 3× more per page at DataForSEO (still well under $1 for a 500-page site) and crawls slower.</span></span></label>
            <div className="md:col-span-2"><SubmitButton className="btn-primary">Save settings</SubmitButton>{!emailConfigured() && <span className="ml-3 text-xs text-amber-700">Email isn&apos;t set up yet (GMAIL_USER and GMAIL_APP_PASSWORD in Vercel), so automatic emails can&apos;t be sent.</span>}</div>
          </form>
        </section>
      )}

      {crawls.length > 1 && (
        <section className="card p-0">
          <h2 className="p-4 pb-2 font-semibold">History</h2>
          {trend.length > 1 && <div className="px-4 pb-2"><TrendChart points={trend} /></div>}
          <table className="table">
            <thead><tr><th>Started</th><th>Status</th><th>Pages</th><th>Health</th><th>Overall</th><th>Email</th></tr></thead>
            <tbody>{crawls.map((c) => <tr key={c.id}><td>{fmtDate(c.startedAt)}{c.scheduled && <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">monthly</span>}{c.jsRender && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">JS</span>}</td><td className="text-xs">{c.status.toLowerCase()}</td><td>{c.pagesCrawled}</td><td>{c.score ?? "—"}</td><td>{(c.advanced as unknown as CrawlDeep | null)?.overall ?? "—"}</td><td className="text-xs">{c.emailedAt ? <span className="text-emerald-700">sent {fmtDate(c.emailedAt)}</span> : c.emailError ? <span className="text-red-600" title={c.emailError}>not sent: {c.emailError}</span> : "—"}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Delta({ label, from, to, neutral }: { label: string; from: number | null; to: number | null; neutral?: boolean }) {
  const d = from != null && to != null ? to - from : null;
  const tone = neutral || !d ? "bg-slate-50 text-slate-700 ring-slate-200" : d > 0 ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200";
  return <span className={`rounded-lg px-2.5 py-1 ring-1 ring-inset ${tone}`}>{label}: {from ?? "—"} → <b>{to ?? "—"}</b>{d ? ` (${d > 0 ? "+" : ""}${d})` : ""}</span>;
}

function ChangeList({ title, items, tone }: { title: string; items: { code: string; title: string; from: number; to: number }[]; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className={`mb-1 font-semibold ${tone}`}>{title} ({items.length})</div>
      {items.length === 0 ? <p className="text-slate-400">None</p> : <ul className="space-y-0.5">{items.slice(0, 12).map((c) => <li key={c.code} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{c.title}</span><span className="shrink-0 tabular-nums text-slate-500">{c.from} → {c.to}</span></li>)}</ul>}
    </div>
  );
}

function TrendChart({ points }: { points: { date: Date; score: number | null; overall: number | null }[] }) {
  const W = 600, H = 120, P = 24;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - P - (v / 100) * (H - 2 * P);
  const line = (k: "score" | "overall") => points.map((p, i) => (p[k] == null ? null : `${x(i)},${y(p[k]!)}`)).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" role="img" aria-label="Score trend">
      {[0, 50, 100].map((v) => <g key={v}><line x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="#e2e8f0" /><text x={4} y={y(v) + 3} fontSize="9" fill="#94a3b8">{v}</text></g>)}
      <polyline points={line("score")} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" />
      <polyline points={line("overall")} fill="none" stroke="#4f46e5" strokeWidth="2.5" />
      {points.map((p, i) => <g key={i}>{p.overall != null && <circle cx={x(i)} cy={y(p.overall)} r="3.5" fill="#4f46e5" />}<text x={x(i)} y={H - 6} fontSize="9" fill="#64748b" textAnchor="middle">{p.date.toISOString().slice(5, 10)}</text></g>)}
      <text x={W - P} y={12} fontSize="10" textAnchor="end" fill="#4f46e5">● Overall</text>
      <text x={W - P - 60} y={12} fontSize="10" textAnchor="end" fill="#94a3b8">-- Site health</text>
    </svg>
  );
}
