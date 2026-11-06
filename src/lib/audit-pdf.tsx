/**
 * Client-ready PDF of a site audit (crawl + deep analysis + AI fixes), branded with the client's colour
 * and logo. Rendered on the server with @react-pdf/renderer. Uses the built-in Helvetica font, so text is
 * cleaned to Latin-1 (emoji and symbols are dropped).
 */
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { SiteCrawl } from "@prisma/client";
import { compareIssues, type CrawlIssue } from "./crawl";
import { db } from "./db";
import type { CrawlDeep, DeepPage } from "./crawl-deep";
import { SECURITY_LABELS } from "./crawl-deep";
import type { CrawlFix } from "./crawl-fix";

type Brand = { client: string; agency: string; color: string; logo: { data: Buffer; format: "png" | "jpg" } | null };

const clean = (s: unknown) => String(s ?? "")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
  .replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/→/g, "->")
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "").replace(/\s{2,}/g, " ").trim();
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const sec = (ms: number | null | undefined) => (ms == null ? "-" : `${(ms / 1000).toFixed(1)}s`);
const kb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const scoreColor = (s: number | null | undefined) => (s == null ? "#94a3b8" : s >= 80 ? "#059669" : s >= 50 ? "#d97706" : "#dc2626");
const SEV = { error: { label: "Error", color: "#dc2626" }, warning: { label: "Warning", color: "#d97706" }, notice: { label: "Notice", color: "#64748b" } } as const;

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 44, fontSize: 9.5, fontFamily: "Helvetica", color: "#1e293b", lineHeight: 1.4 },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 10 },
  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  muted: { color: "#64748b" },
  small: { fontSize: 8, color: "#64748b" },
  row: { flexDirection: "row" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#475569", textTransform: "uppercase" },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 4 },
  card: { borderWidth: 0.75, borderColor: "#e2e8f0", borderRadius: 6, padding: 10, marginBottom: 8 },
  pill: { fontSize: 7.5, paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 6, color: "#fff", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#94a3b8" },
});

function Footer({ b, domain }: { b: Brand; domain: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{clean(`${b.client} - SEO audit of ${domain}`)}</Text>
      <Text render={({ pageNumber, totalPages }) => `Prepared by ${clean(b.agency)}  |  ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Bar({ score, color }: { score: number; color: string }) {
  return (
    <View style={{ height: 7, backgroundColor: "#f1f5f9", borderRadius: 4, flexGrow: 1 }}>
      <View style={{ height: 7, width: `${Math.max(3, Math.min(100, score))}%`, backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

function List({ title, items, fmt, hint, max = 12 }: { title: string; items: DeepPage[]; fmt: (v: number) => string; hint?: string; max?: number }) {
  return (
    <View style={s.card} wrap={false}>
      <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>{clean(title)} ({items.length})</Text>
      {hint && <Text style={[s.small, { marginBottom: 4 }]}>{clean(hint)}</Text>}
      {items.length === 0 ? <Text style={s.muted}>None found.</Text> : items.slice(0, max).map((p) => (
        <View key={p.url} style={[s.row, { justifyContent: "space-between", paddingVertical: 1 }]}>
          <Text style={{ flex: 1, fontSize: 8.5 }}>{clean(path(p.url)).slice(0, 90)}</Text>
          <Text style={{ fontSize: 8.5, color: "#64748b", marginLeft: 8 }}>{fmt(p.value)}</Text>
        </View>
      ))}
      {items.length > max && <Text style={s.small}>...and {items.length - max} more</Text>}
    </View>
  );
}

type Prev = { date: string; score: number | null; overall: number | null; diff: ReturnType<typeof compareIssues> } | null;

function Changes({ title, items, color }: { title: string; items: { code: string; title: string; from: number; to: number }[]; color: string }) {
  return (
    <View style={[s.card, { flex: 1 }]}>
      <Text style={{ fontFamily: "Helvetica-Bold", color, marginBottom: 3 }}>{title} ({items.length})</Text>
      {items.length === 0 ? <Text style={s.muted}>None</Text> : items.slice(0, 8).map((c) => (
        <View key={c.code} style={[s.row, { justifyContent: "space-between" }]}><Text style={{ flex: 1, fontSize: 8.5 }}>{clean(c.title)}</Text><Text style={{ fontSize: 8.5, color: "#64748b" }}>{c.from} -&gt; {c.to}</Text></View>
      ))}
    </View>
  );
}

function Report({ crawl, deep, b, prev }: { crawl: SiteCrawl; deep: CrawlDeep | null; b: Brand; prev: Prev }) {
  const issues = (crawl.issues as unknown as CrawlIssue[] | null) ?? [];
  const fixes = (crawl.aiFixes ?? {}) as Record<string, CrawlFix>;
  const domain = (crawl.domainInfo ?? {}) as Record<string, unknown> & { checks?: Record<string, boolean> };
  const date = (crawl.finishedAt ?? crawl.startedAt).toISOString().slice(0, 10);
  const overall = deep?.overall ?? crawl.score ?? 0;
  const counts = { error: 0, warning: 0, notice: 0 };
  issues.forEach((i) => (counts[i.severity] += 1));
  const checks: [string, string][] = [["ssl", "SSL certificate"], ["sitemap", "XML sitemap"], ["robots_txt", "robots.txt"], ["http2", "HTTP/2"], ["test_https_redirect", "HTTP to HTTPS redirect"], ["test_www_redirect", "www / non-www redirect"], ["test_page_not_found", "Real 404 page"], ["test_canonicalization", "Home page canonical"]];

  return (
    <Document title={`SEO audit - ${crawl.target}`} author={b.agency} subject="Technical SEO audit">
      {/* Cover */}
      <Page size="A4" style={{ fontFamily: "Helvetica", color: "#1e293b" }}>
        <View style={{ backgroundColor: b.color, height: 250, paddingHorizontal: 44, paddingTop: 44 }}>
          {b.logo && <Image src={b.logo} style={{ height: 42, maxWidth: 180, objectFit: "contain", marginBottom: 18, backgroundColor: "#ffffff", padding: 4, borderRadius: 4 }} />}
          <Text style={{ color: "#ffffff", fontSize: 11, opacity: 0.85, letterSpacing: 1.5 }}>TECHNICAL SEO AUDIT</Text>
          <Text style={{ color: "#ffffff", fontSize: 30, fontFamily: "Helvetica-Bold", marginTop: 6 }}>{clean(b.client)}</Text>
          <Text style={{ color: "#ffffff", fontSize: 13, marginTop: 4 }}>{crawl.target}</Text>
          <Text style={{ color: "#ffffff", fontSize: 10, marginTop: 14, opacity: 0.85 }}>{date}  |  {crawl.pagesCrawled} pages crawled</Text>
        </View>
        <View style={{ paddingHorizontal: 44, paddingTop: 30 }}>
          <View style={[s.row, { alignItems: "center", marginBottom: 22 }]}>
            <View style={{ width: 110, height: 110, borderRadius: 55, borderWidth: 9, borderColor: scoreColor(overall), alignItems: "center", justifyContent: "center", marginRight: 26 }}>
              <Text style={{ fontSize: 34, fontFamily: "Helvetica-Bold", color: scoreColor(overall) }}>{overall}</Text>
              <Text style={{ fontSize: 8, color: "#64748b" }}>out of 100</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 6 }}>Overall SEO score</Text>
              <Text style={{ color: SEV.error.color }}>{counts.error} error types</Text>
              <Text style={{ color: SEV.warning.color }}>{counts.warning} warning types</Text>
              <Text style={{ color: SEV.notice.color }}>{counts.notice} notice types</Text>
            </View>
          </View>
          {(deep?.categories ?? [{ key: "technical", label: "Technical health", score: crawl.score ?? 0, note: "" }]).map((c) => (
            <View key={c.key} style={[s.row, { alignItems: "center", marginBottom: 9 }]}>
              <Text style={{ width: 130, fontSize: 10 }}>{clean(c.label)}</Text>
              <Bar score={c.score} color={scoreColor(c.score)} />
              <Text style={{ width: 34, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 10 }}>{c.score}</Text>
            </View>
          ))}
          {deep?.categories.length ? <Text style={[s.small, { marginTop: 4 }]}>{deep.categories.map((c) => `${clean(c.label)}: ${clean(c.note)}`).join("   |   ")}</Text> : null}
        </View>
        <Text style={{ position: "absolute", bottom: 28, left: 44, fontSize: 9, color: "#94a3b8" }}>Prepared by {clean(b.agency)}</Text>
      </Page>

      {/* Summary and plan */}
      {deep?.ai && (
        <Page size="A4" style={s.page}>
          <Text style={s.h1}>Executive summary</Text>
          <Text style={{ fontSize: 10.5, lineHeight: 1.55 }}>{clean(deep.ai.summary)}</Text>
          <View style={[s.row, { marginTop: 12, gap: 10 }]}>
            {deep.ai.strengths.length > 0 && (
              <View style={[s.card, { flex: 1, backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
                <Text style={{ fontFamily: "Helvetica-Bold", color: "#166534", marginBottom: 4 }}>What&apos;s working</Text>
                {deep.ai.strengths.map((x, i) => <Text key={i} style={{ marginBottom: 2 }}>- {clean(x)}</Text>)}
              </View>
            )}
            {deep.ai.quickWins.length > 0 && (
              <View style={[s.card, { flex: 1, backgroundColor: "#eef2ff", borderColor: "#c7d2fe" }]}>
                <Text style={{ fontFamily: "Helvetica-Bold", color: "#3730a3", marginBottom: 4 }}>Quick wins (under 30 minutes)</Text>
                {deep.ai.quickWins.map((x, i) => <Text key={i} style={{ marginBottom: 2 }}>- {clean(x)}</Text>)}
              </View>
            )}
          </View>
          <Text style={s.h2}>Action plan, in priority order</Text>
          {deep.ai.actions.map((a, i) => (
            <View key={i} style={[s.row, { borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 6 }]} wrap={false}>
              <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: b.color, alignItems: "center", justifyContent: "center", marginRight: 8 }}><Text style={{ color: "#fff", fontSize: 8.5, fontFamily: "Helvetica-Bold" }}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{clean(a.title)}</Text>
                <Text style={s.muted}>{clean(a.why)}</Text>
              </View>
              <View style={{ width: 92, alignItems: "flex-end" }}>
                <Text style={[s.pill, { backgroundColor: a.impact === "high" ? "#dc2626" : a.impact === "medium" ? "#d97706" : "#64748b" }]}>{a.impact.toUpperCase()} IMPACT</Text>
                <Text style={[s.small, { marginTop: 2 }]}>{clean(a.effort)}</Text>
                <Text style={s.small}>{clean(a.category)}</Text>
              </View>
            </View>
          ))}
          <Footer b={b} domain={crawl.target} />
        </Page>
      )}

      {/* Speed, site-wide checks, security */}
      <Page size="A4" style={s.page}>
        {deep && deep.speed.length > 0 && (
          <>
            <Text style={s.h1}>Speed and Core Web Vitals</Text>
            <Text style={[s.small, { marginBottom: 6 }]}>Google PageSpeed lab test, plus real Chrome users where available. Good: LCP up to 2.5s, INP up to 200ms, CLS up to 0.1.</Text>
            <View style={s.tr}>
              {["Page", "Mobile", "Desktop", "LCP lab", "CLS lab", "Real LCP", "Real INP", "Real CLS"].map((h, i) => <Text key={h} style={[s.th, { width: i === 0 ? "30%" : "10%" }]}>{h}</Text>)}
            </View>
            {deep.speed.map((x) => (
              <View key={x.url} style={s.tr}>
                <Text style={{ width: "30%", fontSize: 8.5 }}>{clean(path(x.url)).slice(0, 40)}</Text>
                <Text style={{ width: "10%", fontFamily: "Helvetica-Bold", color: scoreColor(x.mobile.performance) }}>{x.mobile.performance ?? "-"}</Text>
                <Text style={{ width: "10%", fontFamily: "Helvetica-Bold", color: scoreColor(x.desktop.performance) }}>{x.desktop.performance ?? "-"}</Text>
                <Text style={{ width: "10%" }}>{sec(x.mobile.lcpMs)}</Text>
                <Text style={{ width: "10%" }}>{x.mobile.cls?.toFixed(2) ?? "-"}</Text>
                <Text style={{ width: "10%" }}>{sec(x.mobile.field?.lcpMs)}</Text>
                <Text style={{ width: "10%" }}>{x.mobile.field?.inpMs != null ? `${x.mobile.field.inpMs}ms` : "-"}</Text>
                <Text style={{ width: "10%" }}>{x.mobile.field?.cls != null ? x.mobile.field.cls.toFixed(2) : "-"}</Text>
              </View>
            ))}
            {!deep.speed.some((x) => x.mobile.field) && <Text style={[s.small, { marginTop: 4 }]}>Real-user columns are empty because Google does not yet have enough Chrome visits to this site to publish field data. That is normal for smaller sites; the lab scores still apply.</Text>}
            {(deep.speed[0]?.mobile.opportunities?.length ?? 0) > 0 && (
              <View style={[s.card, { marginTop: 8 }]}>
                <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>Biggest speed savings (home page, mobile)</Text>
                {deep.speed[0].mobile.opportunities!.map((o) => <View key={o.title} style={[s.row, { justifyContent: "space-between" }]}><Text>{clean(o.title)}</Text><Text style={{ color: "#d97706" }}>-{sec(o.savingsMs)}</Text></View>)}
              </View>
            )}
          </>
        )}
        <Text style={s.h2}>Site-wide checks</Text>
        <View style={[s.row, { flexWrap: "wrap", gap: 5 }]}>
          {checks.filter(([k]) => domain.checks && k in domain.checks).map(([k, label]) => {
            const ok = !!domain.checks![k];
            return <Text key={k} style={[s.pill, { backgroundColor: ok ? "#059669" : "#dc2626", fontSize: 8, paddingVertical: 3 }]}>{ok ? "OK" : "MISSING"}  {label}</Text>;
          })}
        </View>
        {deep?.security && (
          <>
            <Text style={s.h2}>Security</Text>
            <View style={[s.row, { flexWrap: "wrap", gap: 5 }]}>
              <Text style={[s.pill, { backgroundColor: deep.security.https ? "#059669" : "#dc2626", fontSize: 8, paddingVertical: 3 }]}>{deep.security.https ? "OK" : "MISSING"}  HTTPS</Text>
              {Object.entries(deep.security.headers).map(([k, v]) => <Text key={k} style={[s.pill, { backgroundColor: v ? "#059669" : "#d97706", fontSize: 8, paddingVertical: 3 }]}>{v ? "OK" : "MISSING"}  {clean(SECURITY_LABELS[k] ?? k)}</Text>)}
            </View>
            {deep.security.mixedContent.length > 0 && <Text style={[s.small, { marginTop: 4 }]}>{deep.security.mixedContent.length} file(s) on the home page load over insecure http://</Text>}
          </>
        )}
        {deep && (
          <>
            <Text style={s.h2}>HTTP status and click depth</Text>
            <Text>Status codes: {Object.entries(deep.status).map(([k, v]) => `${k}: ${v}`).join("   ")}</Text>
            <Text>Pages by clicks from the home page: {Object.entries(deep.depth).map(([k, v]) => `${k === "none" ? "no link path" : k}: ${v}`).join("   ")}</Text>
            {(deep.depth.none ?? 0) > 0 && <Text style={s.small}>&quot;No link path&quot; pages were found only through the sitemap: no internal link leads to them.</Text>}
          </>
        )}
        <Footer b={b} domain={crawl.target} />
      </Page>

      {/* Issues */}
      <Page size="A4" style={s.page}>
        {prev && (
          <View wrap={false} style={{ marginBottom: 12 }}>
            <Text style={s.h1}>Progress since the last audit ({prev.date})</Text>
            <Text style={{ marginBottom: 6 }}>
              Site health {prev.score ?? "-"} -&gt; {crawl.score ?? "-"}{prev.overall != null && deep ? `   |   Overall score ${prev.overall} -> ${deep.overall}` : ""}   |   {prev.diff.fixed.length} issue types fixed, {prev.diff.added.length} new, {prev.diff.worse.length} worse, {prev.diff.better.length} better
            </Text>
            <View style={[s.row, { gap: 8 }]}>
              <Changes title="Fixed" items={prev.diff.fixed} color="#059669" />
              <Changes title="New problems" items={prev.diff.added} color="#dc2626" />
              <Changes title="Got worse" items={prev.diff.worse} color="#d97706" />
            </View>
          </View>
        )}
        <Text style={s.h1}>Issues found ({issues.length})</Text>
        <View style={s.tr}><Text style={[s.th, { width: "13%" }]}>Severity</Text><Text style={[s.th, { width: "45%" }]}>Issue</Text><Text style={[s.th, { width: "10%" }]}>Pages</Text><Text style={[s.th, { width: "32%" }]}>How to fix</Text></View>
        {issues.map((i) => (
          <View key={i.code} style={s.tr} wrap={false}>
            <View style={{ width: "13%" }}><Text style={[s.pill, { backgroundColor: SEV[i.severity].color, alignSelf: "flex-start" }]}>{SEV[i.severity].label.toUpperCase()}</Text></View>
            <Text style={{ width: "45%", fontFamily: "Helvetica-Bold" }}>{clean(i.title)}</Text>
            <Text style={{ width: "10%" }}>{i.count}</Text>
            <Text style={{ width: "32%", fontSize: 8.5, color: "#475569" }}>{clean(i.hint)}</Text>
          </View>
        ))}
        {issues.some((i) => fixes[i.code]) && (
          <>
            <Text style={[s.h2, { marginTop: 18 }]} minPresenceAhead={120}>Detailed fixes</Text>
            {issues.filter((i) => fixes[i.code]).map((i) => {
              const f = fixes[i.code];
              return (
                <View key={i.code} style={s.card} wrap={false}>
                  <View style={[s.row, { justifyContent: "space-between", marginBottom: 3 }]}>
                    <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10.5 }}>{clean(i.title)}</Text>
                    {f.effort && <Text style={s.small}>Effort: {clean(f.effort)}</Text>}
                  </View>
                  {f.summary && <Text>{clean(f.summary)}</Text>}
                  {f.why && <Text style={[s.muted, { marginBottom: 3 }]}>Why it matters: {clean(f.why)}</Text>}
                  {f.steps.map((st, k) => <Text key={k} style={{ marginLeft: 6 }}>{k + 1}. {clean(st.replace(/^\s*\d+[.)]\s*/, ""))}</Text>)}
                  {f.pages.slice(0, 6).map((p) => (
                    <View key={p.url} style={{ marginTop: 4, padding: 5, backgroundColor: "#f8fafc", borderRadius: 4 }} wrap={false}>
                      <Text style={{ fontSize: 8, color: "#4f46e5" }}>{clean(p.url)}</Text>
                      {p.current && <Text style={{ fontSize: 8, color: "#64748b" }}>Now: {clean(p.current)}</Text>}
                      <Text style={{ fontSize: 8.5 }}>Use: {clean(p.suggested)}</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </>
        )}
        <Footer b={b} domain={crawl.target} />
      </Page>

      {/* Links, visibility, content */}
      {deep && (
        <Page size="A4" style={s.page}>
          <Text style={s.h1}>Internal links, visibility and content</Text>
          <List title="Weakly linked pages (0-1 internal links in)" items={deep.weakLinked} fmt={(v) => `${v} link${v === 1 ? "" : "s"}`} hint="Link to these from related posts and service pages so Google finds and values them." />
          <List title="Buried pages (more than 3 clicks deep)" items={deep.deepPages} fmt={(v) => `${v} clicks`} />
          {!deep.indexing && deep.gscState && (
            <Text style={[s.muted, { marginBottom: 6 }]}>
              {deep.gscState === "no_data" ? "Google visibility: Search Console returned no data for this site, so it was not scored." : deep.gscState === "mismatch" ? "Google visibility: the linked Search Console property belongs to another website, so it was not scored." : "Google visibility: Search Console is not linked yet, so it was not scored."}
            </Text>
          )}
          {deep.indexing && (
            <>
              <Text style={[s.muted, { marginBottom: 6 }]}>{deep.indexing.withImpressions} of {deep.indexing.crawledOk} live pages appeared in Google search in the last 28 days.</Text>
              <List title="Pages Google isn't showing" items={deep.indexing.noImpressions} fmt={(v) => `${v} link${v === 1 ? "" : "s"} in`} hint="Check indexing in Search Console, improve, link to them, or merge/noindex low-value pages." />
              <List title="Pages getting impressions that the crawl didn't find" items={deep.indexing.notCrawled} fmt={(v) => `${v} impr.`} hint="Usually old URLs or orphan pages: 301-redirect old ones or link to live ones." />
            </>
          )}
          {deep.cannibal.length > 0 && (
            <View style={s.card}>
              <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>Keyword cannibalisation ({deep.cannibal.length})</Text>
              <Text style={[s.small, { marginBottom: 4 }]}>Several pages compete for the same search. Pick one page per search and merge or differentiate the others.</Text>
              {deep.cannibal.slice(0, 10).map((c) => (
                <View key={c.query} style={{ marginBottom: 3 }} wrap={false}>
                  <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 8.5 }}>&quot;{clean(c.query)}&quot; ({c.impressions} impr.)</Text>
                  {c.pages.map((p) => <Text key={p.url} style={{ fontSize: 8, marginLeft: 8, color: "#475569" }}>{clean(path(p.url)).slice(0, 80)}  -  position {p.position}, {p.impressions} impr.</Text>)}
                </View>
              ))}
            </View>
          )}
          <List title="Thin pages (under 300 words)" items={deep.thinPages} fmt={(v) => `${v} words`} />
          <List title="Heavy pages (over 500 KB)" items={deep.heavyPages} fmt={kb} />
          <List title="Large images (over 200 KB)" items={deep.bigImages} fmt={kb} hint="Compress and convert to WebP." />
          <List title="Slow pages in the crawl (over 1.5s)" items={deep.slowPages} fmt={sec} />
          <Footer b={b} domain={crawl.target} />
        </Page>
      )}

      {deep && (deep.files || (deep.schema?.length ?? 0) > 0) && (
        <Page size="A4" style={s.page}>
          <Text style={s.h1}>Sitemap, structured data and AI search</Text>
          {deep.files && (
            <>
              <View style={[s.row, { flexWrap: "wrap", gap: 5, marginBottom: 8 }]}>
                {([
                  [deep.files.robots, "robots.txt"],
                  [deep.files.sitemaps.length > 0, `XML sitemap${deep.files.sitemapUrls ? ` (${deep.files.sitemapUrls} URLs)` : ""}`],
                  [deep.files.sitemapBad.length === 0, `${deep.files.sitemapBad.length} sitemap URLs redirect or error`],
                  [deep.files.notInSitemap.length === 0, `${deep.files.notInSitemap.length} live pages not in the sitemap`],
                  [deep.files.aiBotsBlocked.length === 0, deep.files.aiBotsBlocked.length ? `Blocks AI crawlers: ${deep.files.aiBotsBlocked.join(", ")}` : "AI crawlers allowed"],
                  [deep.files.llmsTxt, "llms.txt"],
                ] as [boolean, string][]).map(([ok, label]) => <Text key={label} style={[s.pill, { backgroundColor: ok ? "#059669" : "#d97706", fontSize: 8, paddingVertical: 3 }]}>{ok ? "OK" : "CHECK"}  {clean(label)}</Text>)}
              </View>
              {deep.files.sitemapNotCrawled > 0 && <Text style={[s.small, { marginBottom: 6 }]}>{deep.files.sitemapNotCrawled} sitemap URLs were not reached by following links (no internal links to them, or beyond the crawl limit).</Text>}
              <List title="Sitemap URLs that redirect or error" items={deep.files.sitemapBad} fmt={(v) => (v ? String(v) : "-")} hint="A sitemap should only list final, working, indexable URLs." />
              <List title="Live pages missing from the sitemap" items={deep.files.notInSitemap} fmt={(v) => `${v} links in`} />
            </>
          )}
          {(deep.schema?.length ?? 0) > 0 && (
            <>
              <Text style={s.h2}>Structured data on key pages</Text>
              <View style={s.tr}>{["Page", "Schema types", "Social preview", "Lang"].map((h, i) => <Text key={h} style={[s.th, { width: ["32%", "44%", "14%", "10%"][i] }]}>{h}</Text>)}</View>
              {deep.schema!.map((p) => (
                <View key={p.url} style={s.tr} wrap={false}>
                  <Text style={{ width: "32%", fontSize: 8.5 }}>{clean(path(p.url)).slice(0, 45)}</Text>
                  <Text style={{ width: "44%", fontSize: 8.5, color: p.types.length ? "#1e293b" : "#dc2626" }}>{clean(p.types.join(", ")) || "None"}</Text>
                  <Text style={{ width: "14%", fontSize: 8.5 }}>{p.og ? "Yes" : "No"}</Text>
                  <Text style={{ width: "10%", fontSize: 8.5 }}>{clean(p.lang) || "-"}</Text>
                </View>
              ))}
              <Text style={[s.small, { marginTop: 6 }]}>Business schema (LocalBusiness or Organization) on the home page, Article, FAQ and Service schema on content pages, and open access for AI crawlers help Google AI Overviews, ChatGPT and Perplexity understand and cite the business.</Text>
            </>
          )}
          <Footer b={b} domain={crawl.target} />
        </Page>
      )}

      {/* Appendix */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Appendix: example pages per issue</Text>
        {issues.filter((i) => i.urls.length || i.links?.length).map((i) => (
          <View key={i.code} style={{ marginBottom: 7 }} wrap={false}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{clean(i.title)} ({i.count})</Text>
            {i.links?.length
              ? i.links.slice(0, 12).map((l, k) => <Text key={k} style={{ fontSize: 8, color: "#475569" }}>{clean(path(l.from)).slice(0, 50)}  -&gt;  {clean(l.to).slice(0, 70)}{l.status ? ` (${l.status})` : ""}</Text>)
              : i.groups?.length
                ? i.groups.slice(0, 5).map((g, k) => <Text key={k} style={{ fontSize: 8, color: "#475569" }}>&quot;{clean(g.value).slice(0, 60)}&quot;: {g.urls.slice(0, 4).map((u) => clean(path(u))).join(", ").slice(0, 120)}</Text>)
                : i.urls.slice(0, 10).map((u) => <Text key={u} style={{ fontSize: 8, color: "#475569" }}>{clean(u).slice(0, 110)}</Text>)}
          </View>
        ))}
        <Footer b={b} domain={crawl.target} />
      </Page>
    </Document>
  );
}

async function loadLogo(url: string | null | undefined): Promise<Brand["logo"]> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const type = res.headers.get("content-type") ?? "";
    const format = /png/i.test(type) || /\.png(\?|$)/i.test(url) ? "png" : /jpe?g/i.test(type) || /\.jpe?g(\?|$)/i.test(url) ? "jpg" : null;
    if (!res.ok || !format) return null;
    return { data: Buffer.from(await res.arrayBuffer()), format };
  } catch {
    return null;
  }
}

export async function auditPdf(crawl: SiteCrawl, client: { name: string; brandPrimaryColor: string | null; logoUrl: string | null }) {
  const color = /^#[0-9a-f]{6}$/i.test(client.brandPrimaryColor ?? "") ? client.brandPrimaryColor! : "#4f46e5";
  const b: Brand = { client: client.name, agency: process.env.REPORT_AGENCY_NAME || "Digital Oasis", color, logo: await loadLogo(client.logoUrl) };
  const deep = (crawl.advanced as unknown as CrawlDeep | null) ?? null;
  const p = await db.siteCrawl.findFirst({ where: { clientId: crawl.clientId, status: "DONE", startedAt: { lt: crawl.startedAt } }, orderBy: { startedAt: "desc" } });
  const prev: Prev = p ? {
    date: (p.finishedAt ?? p.startedAt).toISOString().slice(0, 10), score: p.score,
    overall: (p.advanced as unknown as CrawlDeep | null)?.overall ?? null,
    diff: compareIssues((p.issues as unknown as CrawlIssue[] | null) ?? [], (crawl.issues as unknown as CrawlIssue[] | null) ?? []),
  } : null;
  try {
    return await renderToBuffer(<Report crawl={crawl} deep={deep} b={b} prev={prev} />);
  } catch (e) {
    // A logo in an unusual image format can break rendering: try again without it.
    if (!b.logo) throw e;
    console.error("Audit PDF failed with logo, retrying without it:", e);
    return renderToBuffer(<Report crawl={crawl} deep={deep} b={{ ...b, logo: null }} prev={prev} />);
  }
}
