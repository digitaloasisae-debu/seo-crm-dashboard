import { db } from "@/lib/db";
import { canEdit } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { ScoreRing } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { RefreshWhile } from "@/components/refresh-while";
import { Spinner } from "@/components/spinner";
import { fmtDate } from "@/lib/utils";
import { dataforseoConfigured } from "@/lib/dataforseo";
import { pollCrawl, type CrawlIssue } from "@/lib/crawl";
import { after } from "next/server";
import { fixIssueAction, rerunDeepAction, startCrawlAction } from "./actions";
import { claimDeep, runDeepSafe, type CrawlDeep } from "@/lib/crawl-deep";
import { DeepAudit } from "@/components/deep-audit";
import { EmailReport } from "@/components/email-report";
import { emailConfigured } from "@/lib/email";
import { geminiConfigured } from "@/lib/gemini";
import type { CrawlFix } from "@/lib/crawl-fix";

export const maxDuration = 300;

const SEV = {
  error: { label: "Errors", dot: "bg-red-500", chip: "bg-red-50 text-red-700 ring-red-200" },
  warning: { label: "Warnings", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  notice: { label: "Notices", dot: "bg-slate-400", chip: "bg-slate-50 text-slate-600 ring-slate-200" },
} as const;

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

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; open?: string }> }) {
  const { id } = await params;
  const { err, open } = await searchParams;
  const user = await requireUser();
  const [editable, crawls] = await Promise.all([canEdit(user, id), db.siteCrawl.findMany({ where: { clientId: id }, orderBy: { startedAt: "desc" }, take: 10 })]);
  let current = crawls[0] ?? null;
  if (current?.status === "RUNNING") current = await pollCrawl(current);
  const done = current?.status === "DONE" ? current : crawls.find((c) => c.status === "DONE") ?? null;
  const issues = (done?.issues as unknown as CrawlIssue[] | null) ?? [];
  const domain = (done?.domainInfo ?? {}) as Record<string, unknown> & { checks?: Record<string, boolean> };
  const metrics = (done?.metrics ?? {}) as Record<string, number>;
  const counts = { error: 0, warning: 0, notice: 0 };
  issues.forEach((i) => (counts[i.severity] += 1));
  const ready = dataforseoConfigured();
  const fixes = (done?.aiFixes ?? {}) as Record<string, CrawlFix>;
  // The deep analysis starts by itself the first time a finished audit is opened.
  if (done && !done.advancedAt && (await claimDeep(done.id))) {
    const crawlId = done.id;
    after(() => runDeepSafe(crawlId));
    done.advancedStartedAt = new Date();
  }
  const deep = done?.advanced as unknown as CrawlDeep | null;
  const clientInfo = await db.client.findUnique({ where: { id }, select: { reportEmails: true, submittedBy: true } });
  const reportTo = clientInfo?.reportEmails.length ? clientInfo.reportEmails.join(", ") : /@/.test(clientInfo?.submittedBy ?? "") ? clientInfo!.submittedBy! : "";
  const deepRunning = !!done && !done.advancedAt && !!done.advancedStartedAt && Date.now() - done.advancedStartedAt.getTime() < 6 * 60_000;
  const ai = geminiConfigured();

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Full technical audit</h2>
          <p className="text-sm text-slate-500">Crawls the whole site (up to {current?.maxPages ?? (Number(process.env.DATAFORSEO_AUDIT_MAX_PAGES) || 500)} pages) and runs 60+ checks on every page: errors, redirects, duplicates, speed, indexing, schema and more.</p>
          {err && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{err.startsWith("AI fix") ? err : <>Couldn&apos;t start: {err}</>}</p>}
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
          <section className="grid gap-6 md:grid-cols-3">
            <div className="card flex items-center gap-4">
              <ScoreRing score={done.score} size={96} />
              <div>
                <div className="font-semibold">Site health</div>
                <div className="text-xs text-slate-500">{done.pagesCrawled} pages · {fmtDate(done.finishedAt)}</div>
                <div className="mt-2 space-y-0.5 text-xs">
                  {(["error", "warning", "notice"] as const).map((k) => <div key={k} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${SEV[k].dot}`} />{counts[k]} {SEV[k].label.toLowerCase()}</div>)}
                </div>
              </div>
            </div>
            <div className="card md:col-span-2">
              <div className="mb-2 font-semibold">Site-wide checks</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(DOMAIN_CHECKS).filter(([k]) => domain.checks && k in domain.checks).map(([k, label]) => {
                  const ok = DOMAIN_BAD.has(k) ? !domain.checks![k] : !!domain.checks![k];
                  return <span key={k} className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{ok ? "✓" : "✕"} {label}</span>;
                })}
                {domain.checks?.start_page_deny_flag && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700 ring-1 ring-red-200 ring-inset">✕ Home page blocked for crawlers</span>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 md:grid-cols-4">
                {domain.cms ? <span>CMS: {String(domain.cms)}</span> : null}
                {domain.server ? <span>Server: {String(domain.server)}</span> : null}
                {metrics.links_internal != null && <span>Internal links: {metrics.links_internal.toLocaleString()}</span>}
                {metrics.links_external != null && <span>External links: {metrics.links_external.toLocaleString()}</span>}
                {metrics.broken_links != null && <span className={metrics.broken_links ? "text-red-600" : ""}>Broken links: {metrics.broken_links}</span>}
                {metrics.duplicate_title != null && <span>Duplicate titles: {metrics.duplicate_title}</span>}
                {metrics.duplicate_content != null && <span>Duplicate content: {metrics.duplicate_content}</span>}
                {metrics.non_indexable != null && <span>Not indexable: {metrics.non_indexable}</span>}
              </div>
            </div>
          </section>

          <section className="card flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Deep analysis and report</h2>
              <p className="text-sm text-slate-500">Speed and Core Web Vitals, Google visibility, internal links, content, security and an AI action plan{done.advancedAt && deep ? `, from ${fmtDate(done.advancedAt)}` : ""}.</p>
              {done.advancedError && <p className="mt-1 text-xs text-red-700">{done.advancedError}</p>}
            </div>
            {deepRunning ? (
              <span className="flex items-center gap-2 text-sm text-indigo-700"><RefreshWhile ms={8000} /><Spinner className="h-4 w-4" />Analysing… about 1–2 minutes</span>
            ) : (
              <>
                {deep && <a href={`/api/audit/${done.id}/pdf`} className="btn-primary">📄 Download PDF report</a>}
                {editable && <form action={rerunDeepAction.bind(null, id, done.id)}><SubmitButton className="btn-secondary">🔄 Re-run analysis</SubmitButton></form>}
                {deep && editable && <EmailReport crawlId={done.id} defaultTo={reportTo} configured={emailConfigured()} />}
              </>
            )}
          </section>

          {deep && <DeepAudit d={deep} />}

          {issues.length === 0 ? <p className="card text-sm text-emerald-700">🎉 No issues found.</p> : (
            <section className="card space-y-2">
              <h2 className="mb-1 font-semibold">Issues to fix ({issues.length})</h2>
              {issues.map((i) => (
                <details key={i.code} id={`issue-${i.code}`} open={open === i.code} className="scroll-mt-4 rounded-xl border border-slate-100 p-3">
                  <summary className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SEV[i.severity].dot}`} />
                    <span className="min-w-0 flex-1 text-sm font-medium">{i.title}</span>
                    {fixes[i.code] && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200 ring-inset">✨ AI fix ready</span>}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${SEV[i.severity].chip}`}>{i.count.toLocaleString()} page{i.count === 1 ? "" : "s"}</span>
                  </summary>
                  <div className="mt-2 space-y-2 pl-5 text-sm">
                    {i.hint && <p className="text-slate-600">💡 {i.hint}</p>}
                    {i.urls.length > 0 && (
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
                </details>
              ))}
            </section>
          )}
        </>
      )}

      {crawls.length > 1 && (
        <section className="card p-0">
          <h2 className="p-4 pb-2 font-semibold">History</h2>
          <table className="table">
            <thead><tr><th>Started</th><th>Status</th><th>Pages</th><th>Health</th></tr></thead>
            <tbody>{crawls.map((c) => <tr key={c.id}><td>{fmtDate(c.startedAt)}</td><td className="text-xs">{c.status.toLowerCase()}</td><td>{c.pagesCrawled}</td><td>{c.score ?? "—"}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
