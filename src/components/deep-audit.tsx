import type { CrawlDeep, DeepPage } from "@/lib/crawl-deep";
import { SECURITY_LABELS } from "@/lib/crawl-deep";
import { ScoreRing } from "@/components/ui";

const tone = (s: number) => (s >= 80 ? "bg-emerald-500" : s >= 50 ? "bg-amber-500" : "bg-red-500");
const toneText = (s: number | null | undefined) => (s == null ? "text-slate-400" : s >= 90 ? "text-emerald-600" : s >= 50 ? "text-amber-600" : "text-red-600");
const sec = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
const kb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const IMPACT = { high: "bg-red-50 text-red-700 ring-red-200", medium: "bg-amber-50 text-amber-800 ring-amber-200", low: "bg-slate-50 text-slate-600 ring-slate-200" } as const;
// Google's Core Web Vitals thresholds (good / needs improvement).
const lcpTone = (ms: number | null | undefined) => (ms == null ? "" : ms <= 2500 ? "text-emerald-600" : ms <= 4000 ? "text-amber-600" : "text-red-600");
const inpTone = (ms: number | null | undefined) => (ms == null ? "" : ms <= 200 ? "text-emerald-600" : ms <= 500 ? "text-amber-600" : "text-red-600");
const clsTone = (v: number | null | undefined) => (v == null ? "" : v <= 0.1 ? "text-emerald-600" : v <= 0.25 ? "text-amber-600" : "text-red-600");

function PageList({ title, items, fmt, empty, hint }: { title: string; items: DeepPage[]; fmt: (v: number) => string; empty: string; hint?: string }) {
  return (
    <details className="rounded-xl border border-slate-100 p-3">
      <summary className="flex items-center gap-2 text-sm font-medium"><span className="flex-1">{title}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{items.length}</span></summary>
      <div className="mt-2 text-xs">
        {hint && <p className="mb-2 text-slate-500">💡 {hint}</p>}
        {items.length === 0 ? <p className="text-slate-500">{empty}</p> : (
          <ul className="space-y-0.5">{items.map((p) => <li key={p.url} className="flex gap-3"><a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-indigo-600 hover:underline">{path(p.url)}</a><span className="shrink-0 tabular-nums text-slate-500">{fmt(p.value)}</span></li>)}</ul>
        )}
      </div>
    </details>
  );
}

export function DeepAudit({ d }: { d: CrawlDeep }) {
  const depthMax = Math.max(1, ...Object.values(d.depth));
  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-4">
            <ScoreRing score={d.overall} size={110} />
            <div><div className="text-lg font-semibold">Overall SEO score</div><div className="text-xs text-slate-500">Weighted across {d.categories.length} areas</div></div>
          </div>
          <div className="grid min-w-[18rem] flex-1 gap-2.5">
            {d.categories.map((c) => (
              <div key={c.key} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-3 text-sm" title={c.note}>
                <span className="truncate">{c.label}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone(c.score)}`} style={{ width: `${Math.max(3, c.score)}%` }} /></div>
                <span className="text-right font-semibold tabular-nums">{c.score}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {d.ai && (
        <section className="card space-y-4">
          <h2 className="font-semibold">✨ Executive summary</h2>
          <p className="text-sm leading-relaxed text-slate-700">{d.ai.summary}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {d.ai.strengths.length > 0 && <div className="rounded-xl bg-emerald-50/60 p-3 text-sm"><div className="mb-1 font-semibold text-emerald-800">What&apos;s working</div><ul className="list-disc space-y-0.5 pl-5">{d.ai.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
            {d.ai.quickWins.length > 0 && <div className="rounded-xl bg-indigo-50/60 p-3 text-sm"><div className="mb-1 font-semibold text-indigo-800">⚡ Quick wins (under 30 min)</div><ul className="list-disc space-y-0.5 pl-5">{d.ai.quickWins.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
          </div>
          {d.ai.actions.length > 0 && (
            <div>
              <div className="mb-2 font-semibold">Action plan, in priority order</div>
              <ol className="space-y-2">
                {d.ai.actions.map((a, i) => (
                  <li key={i} className="flex gap-3 rounded-xl border border-slate-100 p-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{a.title}</div>
                      <div className="text-xs text-slate-500">{a.why}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${IMPACT[a.impact]}`}>{a.impact} impact</span>
                      <span className="text-slate-500">⏱ {a.effort}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {d.speed.length > 0 && (
        <section className="card p-0">
          <div className="p-4 pb-2"><h2 className="font-semibold">⚡ Speed and Core Web Vitals</h2><p className="text-xs text-slate-500">Google PageSpeed (lab test) plus real Chrome users where Google has enough data. Good: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1.</p></div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Page</th><th>Mobile</th><th>Desktop</th><th>LCP (lab)</th><th>CLS</th><th>Real users: LCP</th><th>INP</th><th>CLS</th></tr></thead>
              <tbody>
                {d.speed.map((s) => {
                  const f = s.mobile.field;
                  return (
                    <tr key={s.url}>
                      <td className="max-w-[14rem] truncate text-xs"><a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{path(s.url)}</a>{s.mobile.error && <div className="text-red-600">{s.mobile.error}</div>}</td>
                      <td className={`font-bold ${toneText(s.mobile.performance)}`}>{s.mobile.performance ?? "—"}</td>
                      <td className={`font-bold ${toneText(s.desktop.performance)}`}>{s.desktop.performance ?? "—"}</td>
                      <td className={lcpTone(s.mobile.lcpMs)}>{sec(s.mobile.lcpMs)}</td>
                      <td className={clsTone(s.mobile.cls)}>{s.mobile.cls?.toFixed(2) ?? "—"}</td>
                      <td className={lcpTone(f?.lcpMs)}>{sec(f?.lcpMs)}{f?.origin && <span className="ml-1 text-[10px] text-slate-400">(site)</span>}</td>
                      <td className={inpTone(f?.inpMs)}>{f?.inpMs != null ? `${f.inpMs}ms` : "—"}</td>
                      <td className={clsTone(f?.cls)}>{f?.cls != null ? f.cls.toFixed(2) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!d.speed.some((x) => x.mobile.field) && <p className="px-4 pb-3 text-xs text-slate-500">ℹ️ &ldquo;Real users&rdquo; is empty because Google doesn&apos;t have enough Chrome visits to this site yet to publish field data. That&apos;s normal for smaller sites; the lab scores still apply.</p>}
          {(d.speed[0]?.mobile.opportunities?.length ?? 0) > 0 && (
            <div className="border-t border-slate-100 p-4 text-sm">
              <div className="mb-1 font-medium">Biggest speed savings on the home page (mobile)</div>
              <ul className="space-y-0.5 text-xs">{d.speed[0].mobile.opportunities!.map((o) => <li key={o.title} className="flex justify-between gap-3"><span>{o.title}</span><span className="tabular-nums text-amber-700">−{sec(o.savingsMs)}</span></li>)}</ul>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold">🔗 Internal linking</h2>
          <div>
            <div className="mb-1 text-xs text-slate-500">Pages by clicks from the home page (keep important pages within 3)</div>
            <div className="flex h-24 items-end gap-2">
              {Object.entries(d.depth).map(([k, v]) => (
                <div key={k} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[11px] tabular-nums text-slate-500">{v}</span>
                  <div className={`w-full rounded-t ${k === "4" || k === "5+" ? "bg-amber-400" : k === "none" ? "bg-red-400" : "bg-indigo-400"}`} style={{ height: `${Math.max(2, (v / depthMax) * 70)}%` }} />
                  <span className="whitespace-nowrap text-[11px] text-slate-500" title={k === "none" ? "Found only through the sitemap: no internal link leads to these pages" : undefined}>{k === "none" ? "no link" : k}</span>
                </div>
              ))}
            </div>
          </div>
          <PageList title="Weakly linked pages (0–1 internal links in)" items={d.weakLinked} fmt={(v) => `${v} link${v === 1 ? "" : "s"}`} empty="Every page has at least 2 internal links pointing to it." hint="Link to these from related posts and service pages so Google finds and values them." />
          <PageList title="Buried pages (more than 3 clicks deep)" items={d.deepPages} fmt={(v) => `${v} clicks`} empty="No buried pages." hint="Link to them from the menu, footer, category pages or the home page." />
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">🔎 Visibility in Google</h2>
          {d.indexing ? (
            <>
              <div className="flex items-baseline gap-2"><span className="text-3xl font-bold tabular-nums">{d.indexing.withImpressions}</span><span className="text-sm text-slate-500">of {d.indexing.crawledOk} live pages showed up in Google in the last 28 days</span></div>
              <PageList title="Pages Google isn't showing" items={d.indexing.noImpressions} fmt={(v) => `${v} link${v === 1 ? "" : "s"} in`} empty="Every page got impressions." hint="Check they're indexed (Search Console → URL Inspection), improve them, link to them, or noindex/merge ones with no value." />
              <PageList title="Pages getting impressions that the crawl didn't find" items={d.indexing.notCrawled} fmt={(v) => `${v.toLocaleString()} impr.`} empty="None." hint="Usually old URLs or orphan pages. Redirect old ones (301) or link to the live ones." />
            </>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {d.gscState === "no_data" ? "Search Console is linked but returned no data for the last 28 days, so this wasn't scored. Check the property on the Google page."
                : d.gscState === "mismatch" ? "The linked Search Console property belongs to a different website, so this wasn't scored. Pick the right property on the Google page."
                : "Search Console isn't linked for this client, so this wasn't scored. Link it on the Google page to see which pages Google shows."}
            </p>
          )}
          {d.cannibal.length > 0 && (
            <details className="rounded-xl border border-slate-100 p-3">
              <summary className="flex items-center gap-2 text-sm font-medium"><span className="flex-1">Keyword cannibalisation (pages competing for the same search)</span><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{d.cannibal.length}</span></summary>
              <p className="my-2 text-xs text-slate-500">💡 Pick one page per search, merge or differentiate the others, and point internal links to the winner.</p>
              <div className="space-y-2 text-xs">
                {d.cannibal.map((c) => (
                  <div key={c.query}><div className="font-medium">&ldquo;{c.query}&rdquo; <span className="text-slate-400">· {c.impressions.toLocaleString()} impr.</span></div>
                    <ul className="pl-3">{c.pages.map((p) => <li key={p.url} className="flex gap-3"><span className="min-w-0 flex-1 truncate text-slate-600">{path(p.url)}</span><span className="text-slate-500">pos {p.position} · {p.impressions} impr.</span></li>)}</ul>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold">📄 Content and page weight</h2>
          <PageList title="Thin pages (under 300 words)" items={d.thinPages} fmt={(v) => `${v} words`} empty="No thin pages." hint="Expand with useful sections, merge into a stronger page, or noindex." />
          <PageList title="Heavy pages (over 500 KB)" items={d.heavyPages} fmt={kb} empty="No heavy pages." />
          <PageList title="Large images (over 200 KB)" items={d.bigImages} fmt={kb} empty="No large images." hint="Compress and convert to WebP (e.g. ShortPixel, Imagify or LiteSpeed Image Optimization)." />
          <PageList title="Slow pages (over 1.5s to load in the crawl)" items={d.slowPages} fmt={(v) => sec(v)} empty="No slow pages." />
          <PageList title="Lowest on-page scores" items={d.lowScorePages} fmt={(v) => `${v}/100`} empty="—" />
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">🔒 Security</h2>
          {d.security ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${d.security.https ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{d.security.https ? "✓" : "✕"} HTTPS</span>
                {Object.entries(d.security.headers).map(([k, v]) => <span key={k} className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${v ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>{v ? "✓" : "✕"} {SECURITY_LABELS[k] ?? k}</span>)}
              </div>
              <p className="text-xs text-slate-500">💡 Missing headers can be added in one go with a plugin such as &ldquo;Headers Security Advanced &amp; HSTS WP&rdquo;, or by your host (LiteSpeed/Cloudflare).</p>
              {d.security.mixedContent.length > 0 && <div className="text-xs"><div className="font-medium text-red-700">Files loaded over insecure http:// on the home page</div><ul className="mt-1 space-y-0.5">{d.security.mixedContent.map((u) => <li key={u} className="truncate text-slate-600">{u}</li>)}</ul></div>}
            </>
          ) : <p className="text-sm text-slate-500">Couldn&apos;t load the home page to check.</p>}
          <div className="pt-2">
            <div className="mb-1 text-xs text-slate-500">HTTP status of crawled pages</div>
            <div className="flex flex-wrap gap-2 text-xs">{Object.entries(d.status).map(([k, v]) => <span key={k} className={`rounded-lg px-2 py-1 ring-1 ring-inset ${k === "2xx" ? "bg-emerald-50 ring-emerald-200" : k === "3xx" ? "bg-slate-50 ring-slate-200" : v ? "bg-red-50 text-red-700 ring-red-200" : "bg-slate-50 ring-slate-200"}`}>{k}: <b>{v}</b></span>)}</div>
          </div>
        </div>
      </section>
      {(d.files || (d.schema?.length ?? 0) > 0) && (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-3">
            <h2 className="font-semibold">🗺️ Sitemap and robots.txt</h2>
            {d.files ? (
              <>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Pill ok={d.files.robots}>robots.txt</Pill>
                  <Pill ok={d.files.sitemaps.length > 0}>XML sitemap{d.files.sitemapUrls ? `: ${d.files.sitemapUrls.toLocaleString()} URLs` : ""}</Pill>
                  <Pill ok={d.files.sitemapBad.length === 0}>{d.files.sitemapBad.length} sitemap URLs redirect or error</Pill>
                  <Pill ok={d.files.notInSitemap.length === 0} warn>{d.files.notInSitemap.length} live pages not in the sitemap</Pill>
                </div>
                {d.files.sitemapNotCrawled > 0 && <p className="text-xs text-slate-500">{d.files.sitemapNotCrawled.toLocaleString()} sitemap URLs weren&apos;t reached by the crawl: they have no internal links pointing to them, or the site is bigger than the page limit.</p>}
                <PageList title="Sitemap URLs that redirect or error" items={d.files.sitemapBad} fmt={(v) => (v ? String(v) : "—")} empty="All sitemap URLs load fine." hint="A sitemap should only list final, working, indexable URLs. Regenerate it in your SEO plugin." />
                <PageList title="Live pages missing from the sitemap" items={d.files.notInSitemap} fmt={(v) => `${v} links in`} empty="Every live page is in the sitemap." hint="Make sure these post types/taxonomies are included in the sitemap settings of Yoast or Rank Math (or noindex them if they shouldn't rank)." />
              </>
            ) : <p className="text-sm text-slate-500">Couldn&apos;t load robots.txt or a sitemap.</p>}
          </div>
          <div className="card space-y-3">
            <h2 className="font-semibold">🤖 Structured data and AI search</h2>
            {d.files && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Pill ok={d.files.aiBotsBlocked.length === 0}>{d.files.aiBotsBlocked.length ? `Blocks ${d.files.aiBotsBlocked.join(", ")}` : "AI crawlers allowed (ChatGPT, Claude, Perplexity, Gemini)"}</Pill>
                <Pill ok={d.files.llmsTxt} warn>llms.txt</Pill>
              </div>
            )}
            {(d.schema?.length ?? 0) > 0 && (
              <div className="overflow-x-auto">
                <table className="table text-xs">
                  <thead><tr><th>Page</th><th>Schema types</th><th>Social preview</th><th>Lang</th></tr></thead>
                  <tbody>{d.schema!.map((p) => (
                    <tr key={p.url}>
                      <td className="max-w-[10rem] truncate"><a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{path(p.url)}</a></td>
                      <td className={p.types.length ? "" : "text-red-600"}>{p.types.join(", ") || "None"}</td>
                      <td>{p.og ? "✓" : <span className="text-amber-600">✕</span>}</td>
                      <td className="whitespace-nowrap">{p.lang || <span className="text-amber-600">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-500">💡 Business schema (LocalBusiness or Organization) on the home page, Article/FAQ/Service schema on content, and open access for AI crawlers help Google AI Overviews, ChatGPT and Perplexity understand and cite the business. Rank Math and Yoast add most of this.</p>
          </div>
        </section>
      )}

      {d.notes.length > 0 && <p className="text-xs text-slate-400">Notes: {d.notes.join(" · ")}</p>}
    </div>
  );
}

function Pill({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return <span className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : warn ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{ok ? "✓" : "✕"} {children}</span>;
}
