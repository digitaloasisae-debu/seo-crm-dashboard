/**
 * "Website & Google Business Profile Audit": the client-facing report in the agency layout.
 * Part A website (on-page, content, images, speed, technical, off-page, AI), one part per Google
 * Business Profile, then a plan of action and conclusion. Built from the latest crawl + deep analysis
 * and the client's GBP profiles.
 */
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer, Svg, Polyline, Line, Circle, Text as SvgText } from "@react-pdf/renderer";
import type { GbpProfile, SiteCrawl } from "@prisma/client";
import { db } from "./db";
import { clean, loadLogo } from "./audit-pdf";
import { getAgency, logoForPdf } from "./report-brand";
import { CoverHero, polishLogo, type PdfLogo } from "./report-cover";
import type { CrawlIssue, Sev } from "./crawl";
import type { CrawlDeep, Section, SectionKey } from "./crawl-deep";
import { ensureShots } from "./crawl-deep";
import type { Shot } from "./audit";
import { grade } from "./crawl-market";
import { directoryLinks, hoursText, type GbpAi, type GbpFinding, type GbpInfo } from "./gbp";

type Logo = PdfLogo;
type Row = { sev: Sev; title: string; pages: string; added: number; fixed: number };
type B = { color: string; dark: string; gold: string; agency: string; agencyWebsite: string; logo: Logo; agencyLogo: Logo; client: string };

const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const num = (n: number | null | undefined) => (n == null ? "-" : n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("en-US"));
const SEVC: Record<Sev, string> = { error: "#c62828", warning: "#b7791f", notice: "#64748b" };
const SEVL: Record<Sev, string> = { error: "Error", warning: "Warning", notice: "Notice" };

const s = StyleSheet.create({
  page: { paddingTop: 50, paddingBottom: 54, paddingHorizontal: 50, fontSize: 9.5, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.4 },
  topRule: { position: "absolute", top: 34, left: 50, right: 50, height: 0.8 },
  footer: { position: "absolute", bottom: 26, left: 50, right: 50, borderTopWidth: 0.6, borderTopColor: "#d1d5db", paddingTop: 5, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#9ca3af" },
  h2: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 5 },
  p: { marginBottom: 6 },
  muted: { color: "#6b7280" },
  small: { fontSize: 8, color: "#6b7280" },
  row: { flexDirection: "row" },
  th: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 4, paddingHorizontal: 5 },
  td: { fontSize: 8.5, paddingVertical: 4, paddingHorizontal: 5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
});

function Chrome({ b }: { b: B }) {
  return (
    <>
      <View style={[s.topRule, { backgroundColor: b.color }]} fixed />
      <View style={s.footer} fixed>
        <Text>{clean(b.client)} - Website &amp; Google Business Profile Audit</Text>
        <Text render={({ pageNumber, totalPages }) => `Prepared by ${clean(b.agency)}  |  ${pageNumber} / ${totalPages}`} />
      </View>
    </>
  );
}

function PartHeader({ letter, title, b }: { letter: string; title: string; b: B }) {
  return (
    <View style={{ borderBottomWidth: 1.5, borderBottomColor: b.color, paddingBottom: 4, marginBottom: 8, marginTop: 4, flexDirection: "row" }} minPresenceAhead={80}>
      {letter ? <Text style={{ color: b.gold, fontFamily: "Helvetica-Bold", fontSize: 15, lineHeight: 1.2, marginRight: 7 }}>{letter}</Text> : null}
      <Text style={{ color: b.color, fontFamily: "Helvetica-Bold", fontSize: 15, lineHeight: 1.2 }}>{clean(title)}</Text>
    </View>
  );
}

function SectionBar({ title, sub, rows, b }: { title: string; sub: string; rows: Row[]; b: B }) {
  const e = rows.filter((r) => r.sev === "error").length;
  const w = rows.filter((r) => r.sev === "warning").length;
  return (
    <View minPresenceAhead={110} style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#f1f5f4", borderLeftWidth: 3.5, borderLeftColor: b.color, paddingVertical: 6, paddingHorizontal: 9 }}>
        <Text style={{ flex: 1, fontFamily: "Helvetica-Bold", fontSize: 12.5, color: b.dark }}>{clean(title)}</Text>
        <Text style={{ color: SEVC.error, fontFamily: "Helvetica-Bold", fontSize: 9, marginRight: 12 }}>{e} error{e === 1 ? "" : "s"}</Text>
        <Text style={{ color: SEVC.warning, fontFamily: "Helvetica-Bold", fontSize: 9 }}>{w} warning{w === 1 ? "" : "s"}</Text>
      </View>
      <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Oblique", color: "#6b7280", marginTop: 3, marginBottom: 5 }}>{clean(sub)}</Text>
    </View>
  );
}

function Table({ head, widths, rows, b, dark }: { head: string[]; widths: string[]; rows: (string | { text: string; color?: string; bold?: boolean })[][]; b: B; dark?: boolean }) {
  return (
    <View style={{ borderWidth: 0.5, borderColor: "#e5e7eb", marginBottom: 6 }}>
      <View style={[s.row, { backgroundColor: dark ? b.dark : b.color }]} wrap={false}>{head.map((h, i) => <Text key={i} style={[s.th, { width: widths[i] }]}>{clean(h)}</Text>)}</View>
      {rows.map((r, i) => (
        <View key={i} style={[s.tr, { backgroundColor: i % 2 ? "#f8faf9" : "#ffffff" }]} wrap={false}>
          {r.map((c, j) => {
            const o = typeof c === "string" ? { text: c } : c;
            return <Text key={j} style={[s.td, { width: widths[j], color: o.color ?? "#1f2937", fontFamily: o.bold ? "Helvetica-Bold" : "Helvetica" }]}>{clean(o.text)}</Text>;
          })}
        </View>
      ))}
    </View>
  );
}

function IssueTable({ rows, b }: { rows: Row[]; b: B }) {
  if (!rows.length) return <Text style={[s.small, { color: "#047857", marginBottom: 6 }]}>No issues found in this area.</Text>;
  return <Table b={b} dark head={["Issues", "Pages", "New", "Fixed"]} widths={["58%", "14%", "14%", "14%"]} rows={rows.map((r) => [{ text: `${r.sev === "error" ? "x" : r.sev === "warning" ? "!" : "i"}  ${r.title}`, color: SEVC[r.sev] }, r.pages, String(r.added), String(r.fixed)])} />;
}

function DescFix({ sec }: { sec?: Section }) {
  if (!sec || (!sec.description.length && !sec.fix.length)) return null;
  return (
    <View style={[s.row, { marginTop: 4, marginBottom: 4 }]} wrap={false}>
      <View style={{ flex: 1, backgroundColor: "#fdecea", padding: 8 }}>
        <Text style={{ color: "#b42318", fontFamily: "Helvetica-Bold", marginBottom: 3 }}>Issue description</Text>
        {sec.description.map((d, i) => <Text key={i} style={{ marginBottom: 2 }}>{clean(d)}</Text>)}
      </View>
      <View style={{ flex: 1, backgroundColor: "#e7f4ef", padding: 8 }}>
        <Text style={{ color: "#0f766e", fontFamily: "Helvetica-Bold", marginBottom: 3 }}>How to fix</Text>
        {sec.fix.map((d, i) => <Text key={i} style={{ marginBottom: 2 }}>{clean(d)}</Text>)}
      </View>
    </View>
  );
}

/** Page screenshots from Google PageSpeed, each with the problems the crawl found on that page. */
function Screens({ shots, b }: { shots: Shot[]; b: B }) {
  const mobile = shots.filter((x) => x.device === "mobile").slice(0, 4);
  const desktop = shots.find((x) => x.device === "desktop");
  const tone = (n: number | null) => (n == null ? "#4b5563" : n >= 90 ? "#047857" : n >= 50 ? "#b7791f" : "#c62828");
  return (
    <View style={{ marginTop: 6, marginBottom: 8 }}>
      <View wrap={false}>
        <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10, color: b.dark, marginBottom: 2 }}>What the pages look like</Text>
        <Text style={{ fontSize: 7.5, color: "#6b7280", marginBottom: 6 }}>Screenshots taken by Google PageSpeed while loading each page on a phone, with the problems found on that page.</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {mobile.map((x) => (
            <View key={x.url} style={{ width: "23.5%" }}>
              <Image src={x.image} style={{ width: "100%", borderWidth: 0.5, borderColor: "#d1d5db", borderRadius: 4 }} />
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 7.5, marginTop: 3 }}>{clean(x.label).slice(0, 28)}</Text>
              <Text style={{ fontSize: 7, color: tone(x.performance) }}>Mobile speed {x.performance ?? "-"}/100</Text>
              {x.problems.slice(0, 4).map((p) => <Text key={p} style={{ fontSize: 6.5, color: "#c62828", marginTop: 1 }}>x {clean(p).slice(0, 60)}</Text>)}
              {x.problems.length > 4 && <Text style={{ fontSize: 6.5, color: "#6b7280" }}>+{x.problems.length - 4} more</Text>}
            </View>
          ))}
        </View>
      </View>
      {desktop && (
        <View wrap={false} style={{ marginTop: 10, flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <Image src={desktop.image} style={{ width: "62%", borderWidth: 0.5, borderColor: "#d1d5db", borderRadius: 4 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 8 }}>Home page on desktop</Text>
            <Text style={{ fontSize: 7.5, color: tone(desktop.performance) }}>Desktop speed {desktop.performance ?? "-"}/100</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function Tiles({ items, b }: { items: { value: string; label: string; color?: string; bg?: string }[]; b: B }) {
  return (
    <View style={[s.row, { marginBottom: 8, gap: 2 }]} wrap={false}>
      {items.map((t, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: t.bg ?? "#eef4f3", paddingVertical: 11, alignItems: "center" }}>
          <Text style={{ fontSize: 19, lineHeight: 1.2, height: 24, fontFamily: "Helvetica-Bold", color: t.color ?? b.dark }}>{clean(t.value)}</Text>
          <Text style={{ fontSize: 7, color: "#6b7280", marginTop: 3, letterSpacing: 0.5 }}>{clean(t.label.toUpperCase())}</Text>
        </View>
      ))}
    </View>
  );
}

function LineChart({ title, series, b }: { title: string; series: { date: string; value: number }[]; b: B }) {
  if (series.length < 3) return null;
  const W = 490, H = 110, L = 34, R = 8, T = 10, Bm = 18;
  const max = Math.max(...series.map((x) => x.value)) || 1;
  const x = (i: number) => L + (i * (W - L - R)) / (series.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - Bm);
  return (
    <View style={{ borderWidth: 0.5, borderColor: "#e5e7eb", padding: 6, marginBottom: 6 }} wrap={false}>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 2 }}>{clean(title)}</Text>
      <Svg width={W} height={H}>
        {[0, 0.5, 1].map((f) => <Line key={f} x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#e5e7eb" strokeWidth={0.6} />)}
        {[0, 0.5, 1].map((f) => <SvgText key={`t${f}`} x={2} y={y(max * f) + 3} style={{ fontSize: 6.5 }} fill="#9ca3af">{num(Math.round(max * f))}</SvgText>)}
        <Polyline points={series.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} stroke={b.color} strokeWidth={1.8} fill="none" />
        {series.map((p, i) => (i % Math.ceil(series.length / 6) === 0 || i === series.length - 1 ? <SvgText key={`d${i}`} x={x(i) - 12} y={H - 4} style={{ fontSize: 6.5 }} fill="#6b7280">{p.date.slice(0, 7)}</SvgText> : null))}
      </Svg>
    </View>
  );
}

/** Backlink network: the site in the middle, referring domains around it (stronger domains closer, bigger = more links). */
function NetworkGraph({ target, domains, b }: { target: string; domains: { domain: string; rank: number; backlinks: number }[]; b: B }) {
  if (domains.length < 3) return null;
  const W = 490, H = 250, cx = W / 2, cy = H / 2;
  const nodes = domains.slice(0, 40).map((d, i) => {
    const a = i * 2.39996;
    const r = 38 + (1 - Math.min(100, d.rank) / 100) * 80 + (i % 3) * 6;
    return { ...d, x: cx + Math.cos(a) * r * 1.75, y: cy + Math.sin(a) * r, size: Math.min(7, 2 + Math.sqrt(d.backlinks) / 2) };
  });
  const labelled = new Set([...nodes].sort((a, c) => c.rank - a.rank).slice(0, 8).map((n) => n.domain));
  return (
    <View style={{ borderWidth: 0.5, borderColor: "#e5e7eb", padding: 6, marginBottom: 6 }} wrap={false}>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 2 }}>Backlink network ({domains.length} top referring domains)</Text>
      <Svg width={W} height={H}>
        {nodes.map((n, i) => <Line key={`l${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke="#d1d5db" strokeWidth={0.5} />)}
        {nodes.map((n, i) => <Circle key={`c${i}`} cx={n.x} cy={n.y} r={n.size} fill={n.rank >= 40 ? b.color : "#94a3b8"} />)}
        {nodes.filter((n) => labelled.has(n.domain)).map((n, i) => <SvgText key={`t${i}`} x={n.x + n.size + 2} y={n.y + 2} style={{ fontSize: 6 }} fill="#374151">{clean(n.domain).slice(0, 28)}</SvgText>)}
        <Circle cx={cx} cy={cy} r={10} fill={b.dark} />
        <SvgText x={cx - target.length * 2.2} y={cy + 20} style={{ fontSize: 7.5 }} fill={b.dark}>{clean(target)}</SvgText>
      </Svg>
      <Text style={s.small}>Closer to the centre = stronger linking site (higher authority). Coloured dots: authority 40+. Bigger dots: more links to you.</Text>
    </View>
  );
}

const CODES: Record<Exclude<SectionKey, "offpage" | "ai">, string[]> = {
  onpage: ["no_title", "title_too_long", "title_too_short", "irrelevant_title", "duplicate_title", "duplicate_title_tag", "no_description", "irrelevant_description", "duplicate_description", "duplicate_meta_tags", "no_h1_tag"],
  content: ["low_character_count", "duplicate_content", "low_readability_rate", "lorem_ipsum", "deprecated_html_tags"],
  images: ["no_image_alt"],
  speed: ["high_loading_time", "high_waiting_time", "has_render_blocking_resources", "large_page_size", "size_greater_than_3mb", "small_page_size", "no_content_encoding", "unminified_css", "unminified_js"],
  technical: [],
};

function Report({ crawl, deep, profiles, b, prevIssues }: { crawl: SiteCrawl; deep: CrawlDeep | null; profiles: GbpProfile[]; b: B; prevIssues: CrawlIssue[] | null }) {
  const issues = (crawl.issues as unknown as CrawlIssue[] | null) ?? [];
  const prev = new Map((prevIssues ?? []).map((i) => [i.code, i.count]));
  const delta = (code: string, count: number) => (prevIssues ? { added: Math.max(0, count - (prev.get(code) ?? 0)), fixed: Math.max(0, (prev.get(code) ?? 0) - count) } : { added: 0, fixed: 0 });
  const row = (i: CrawlIssue): Row => ({ sev: i.severity, title: i.title, pages: String(i.count), ...delta(i.code, i.count) });
  const used = new Set(Object.values(CODES).flat());
  const by = (k: keyof typeof CODES) => issues.filter((i) => (k === "technical" ? !used.has(i.code) : CODES[k].includes(i.code))).map(row);
  const sec = deep?.ai?.sections ?? {};
  const n = Math.max(1, crawl.pagesCrawled);

  // Extra rows from the deep analysis.
  const onpage = by("onpage");
  const kwMissing = (deep?.keywords ?? []).slice(0, 5).filter((k) => !k.title && !k.description);
  if (kwMissing.length >= 2) onpage.push({ sev: "warning", title: `Weak keyword consistency (${kwMissing.map((k) => k.word).join(", ")} not in title/meta)`, pages: "1", added: 0, fixed: 0 });
  const content = by("content");
  if (deep?.template && deep.template.avgPct >= 30) content.unshift({ sev: deep.template.avgPct >= 50 ? "error" : "warning", title: `Duplicate / templated location or service pages`, pages: `${deep.template.avgPct}%`, added: 0, fixed: 0 });
  if (deep && deep.thinPages.length) content.push({ sev: "warning", title: "Thin pages (under 300 words)", pages: String(deep.thinPages.length), added: 0, fixed: 0 });
  const post = deep?.files?.newestPost;
  if (post && Date.now() - Date.parse(post.date) > 120 * 864e5) content.push({ sev: "warning", title: `Stale blog (last post ${post.date})`, pages: "1", added: 0, fixed: 0 });
  if (deep?.cannibal.length) content.push({ sev: "warning", title: "Keyword cannibalisation (pages competing for one search)", pages: String(deep.cannibal.length), added: 0, fixed: 0 });
  const images = by("images");
  if (deep?.bigImages.length) images.push({ sev: "warning", title: "Large images over 200 KB", pages: String(deep.bigImages.length), added: 0, fixed: 0 });
  const noOg = (deep?.schema ?? []).filter((p) => !p.og).length;
  if (noOg) images.push({ sev: "warning", title: "Pages without a social share (Open Graph) image", pages: `${noOg} / ${deep!.schema!.length}`, added: 0, fixed: 0 });
  const speed = by("speed");
  const home = deep?.speed[0];
  if (home?.mobile.performance != null && home.mobile.performance < 90) speed.unshift({ sev: home.mobile.performance < 50 ? "error" : "warning", title: `Low mobile performance score (${home.mobile.performance})`, pages: String(deep!.speed.length), added: 0, fixed: 0 });
  const technical = by("technical");
  if (deep?.files && !deep.files.robots) technical.push({ sev: "warning", title: "No robots.txt", pages: "-", added: 0, fixed: 0 });
  if (deep?.files && !deep.files.sitemaps.length) technical.push({ sev: "error", title: "No XML sitemap found", pages: "-", added: 0, fixed: 0 });
  if (deep?.files?.sitemapBad.length) technical.push({ sev: "warning", title: "Sitemap lists redirected or broken URLs", pages: String(deep.files.sitemapBad.length), added: 0, fixed: 0 });
  if (deep?.weakLinked.length) technical.push({ sev: "warning", title: "Weakly linked / orphan pages", pages: String(deep.weakLinked.length), added: 0, fixed: 0 });
  const missingHeaders = deep?.security ? Object.values(deep.security.headers).filter((v) => !v).length : 0;
  if (missingHeaders >= 3) technical.push({ sev: "notice", title: `${missingHeaders} security headers missing`, pages: "-", added: 0, fixed: 0 });
  const m = deep?.market;
  const offpage: Row[] = [];
  if (m?.history && m.history.length > 3) {
    const first = m.history[0].backlinks, last = m.history[m.history.length - 1].backlinks;
    if (first > 0 && last < first * 0.7) offpage.push({ sev: "error", title: `Backlinks declining (${num(first)} -> ${num(last)} in 12 months)`, pages: "-", added: 0, fixed: 0 });
  }
  if (m?.authority != null && m.authority < 20) offpage.push({ sev: "warning", title: `Low authority score (${m.authority}/100)`, pages: "-", added: 0, fixed: 0 });
  const stronger = (m?.competitors ?? []).filter((c) => !c.you && (c.traffic ?? 0) > (m?.traffic ?? 0));
  if (stronger.length) offpage.push({ sev: "notice", title: `${stronger.length} competitor${stronger.length === 1 ? " gets" : "s get"} more organic traffic`, pages: "-", added: 0, fixed: 0 });
  const ai: Row[] = [];
  if (m?.aiVisibility && m.aiVisibility.cited === 0) ai.push({ sev: "warning", title: "Site is never cited as a source in AI answers", pages: "-", added: 0, fixed: 0 });
  if (deep?.files && !deep.files.llmsTxt) ai.push({ sev: "notice", title: "No llms.txt file", pages: "-", added: 0, fixed: 0 });
  if (deep?.files?.aiBotsBlocked.length) ai.push({ sev: "error", title: `robots.txt blocks AI crawlers (${deep.files.aiBotsBlocked.join(", ")})`, pages: "-", added: 0, fixed: 0 });
  const homeSchema = deep?.schema?.[0]?.types ?? [];
  if (deep?.schema?.length && !homeSchema.some((t) => /Organization|LocalBusiness|Service|Store|Contractor|Professional/i.test(t))) ai.push({ sev: "warning", title: "No business (LocalBusiness/Organization) schema on the home page", pages: "1", added: 0, fixed: 0 });
  const noSchema = (deep?.schema ?? []).filter((p) => !p.types.length).length;
  if (noSchema) ai.push({ sev: "warning", title: "Key pages without structured data", pages: `${noSchema} / ${deep!.schema!.length}`, added: 0, fixed: 0 });

  const all = [...onpage, ...content, ...images, ...speed, ...technical, ...offpage, ...ai];
  const recs = all.filter((r) => r.sev !== "notice").length;
  const top = [...all].sort((a, c) => (a.sev === c.sev ? 0 : a.sev === "error" ? -1 : c.sev === "error" ? 1 : a.sev === "warning" ? -1 : 1)).slice(0, 6);
  const overall = deep?.overall ?? crawl.score ?? 0;
  const gbps = profiles.filter((p) => p.data);
  const letters = "BCDEFGHIJK";
  const planLetter = letters[gbps.length] ?? "Z";
  const pri = (impact: string) => (impact === "high" ? "P1" : impact === "medium" ? "P2" : "P3");
  const PRIC: Record<string, string> = { P1: "#c62828", P2: "#b7791f", P3: "#2563eb" };

  return (
    <Document title={`Website & Google Business Profile Audit - ${crawl.target}`} author={b.agency}>
      {/* Cover */}
      <Page size="A4" style={[s.page, { paddingTop: 0, paddingHorizontal: 0 }]}>
        <Chrome b={b} />
        <CoverHero logo={b.logo} brand={clean(b.agency)} color={b.color} kicker="Website & Google Business Profile audit" title={clean(b.client)} subtitle={crawl.target} meta={`${(crawl.finishedAt ?? crawl.startedAt).toISOString().slice(0, 10)}   |   ${crawl.pagesCrawled} pages crawled`} />
        <View style={{ paddingHorizontal: 50, paddingTop: 22 }}>
        <Tiles b={b} items={[{ value: grade(overall), label: "Health grade", color: "#2563eb" }, { value: String(recs), label: "Recommendations", color: b.gold, bg: "#fbf5e1" }, { value: String(gbps.length), label: "GBP profiles", color: b.color }]} />
        <Tiles b={b} items={[{ value: m?.authority != null ? String(m.authority) : "-", label: "Authority score" }, { value: num(m?.traffic), label: "Organic traffic / mo", color: b.color }, { value: num(m?.keywords), label: "Organic keywords", color: b.color }]} />
        <Text style={[s.h2, { marginTop: 16 }]}>Report Contents</Text>
        <Table b={b} head={["Part", "Section"]} widths={["16%", "84%"]} rows={[
          ["Part A", "Website SEO Audit - on-page, content, images, speed, technical, off-page, AI search"],
          ...gbps.map((p, i) => [`Part ${letters[i]}`, `Google Business Profile Audit - ${p.label}${gbps.length > 1 ? " (audited separately)" : ""}`]),
          [`Part ${planLetter}`, `Plan of Action - Website${gbps.map((p) => `, GBP ${p.label}`).join("")}`],
        ]} />
        <Text style={[s.small, { marginTop: 8 }]}>{clean(`${crawl.pagesCrawled} pages crawled on ${(crawl.finishedAt ?? crawl.startedAt).toISOString().slice(0, 10)}. Prepared by ${b.agency}${b.agencyWebsite ? ` (${b.agencyWebsite.replace(/^https?:\/\//, "")})` : ""}.`)}</Text>
        </View>
      </Page>

      {/* Part A */}
      <Page size="A4" style={s.page}>
        <Chrome b={b} />
        <PartHeader letter="A" title="Website SEO Audit" b={b} />
        <Text style={s.p}>{clean(`This part reviews on-page SEO, content, images, speed, technical health, off-page authority and AI-search readiness for ${crawl.target}. Every finding comes from a full crawl of ${crawl.pagesCrawled} pages plus Google PageSpeed${deep?.gscState === "ok" ? ", Google Search Console" : ""} and backlink data.`)}</Text>
        {deep?.ai?.summary && <Text style={[s.p, { color: "#374151" }]}>{clean(deep.ai.summary)}</Text>}
        <Text style={s.h2}>Top Issues</Text>
        <Table b={b} head={["Issue", "Severity", "Affected"]} widths={["60%", "20%", "20%"]} rows={top.map((r) => [r.title, { text: SEVL[r.sev], color: SEVC[r.sev], bold: true }, r.pages])} />
        {deep && (
          <View style={[s.row, { gap: 4, marginTop: 4, marginBottom: 4 }]} wrap={false}>
            {deep.categories.map((c) => (
              <View key={c.key} style={{ flex: 1, alignItems: "center", borderWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 7 }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 3.5, borderColor: c.score >= 80 ? "#059669" : c.score >= 50 ? "#d97706" : "#dc2626", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{grade(c.score)}</Text>
                </View>
                <Text style={{ fontSize: 7, color: "#4b5563", marginTop: 4, textAlign: "center" }}>{clean(c.label)}</Text>
              </View>
            ))}
          </View>
        )}

        <SectionBar b={b} title="On-Page & Meta Tags" sub="Meta tags and headings tell search engines what each page is about." rows={onpage} />
        <IssueTable rows={onpage} b={b} />
        {(deep?.keywords?.length ?? 0) > 0 && (
          <View wrap={false}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 3 }}>Keyword consistency (home page)</Text>
            <Table b={b} head={["Keyword", "Title", "Meta description", "Headings", "Page frequency"]} widths={["28%", "14%", "22%", "16%", "20%"]}
              rows={deep!.keywords!.map((k) => [k.word, { text: k.title ? "Yes" : "No", color: k.title ? "#047857" : "#c62828" }, { text: k.description ? "Yes" : "No", color: k.description ? "#047857" : "#c62828" }, { text: k.headings ? "Yes" : "No", color: k.headings ? "#047857" : "#c62828" }, String(k.count)])} />
          </View>
        )}
        <DescFix sec={sec.onpage} />

        <SectionBar b={b} title="Content" sub="Content is the core of SEO: duplication, depth and freshness." rows={content} />
        <IssueTable rows={content} b={b} />
        {deep?.template && deep.template.avgPct >= 30 && (
          <Table b={b} head={["Page", "Most similar to", "Shared text"]} widths={["42%", "42%", "16%"]} rows={deep.template.pages.slice(0, 8).map((p) => [path(p.url).slice(0, 48), path(p.similarTo).slice(0, 48), { text: `${p.pct}%`, color: p.pct >= 50 ? "#c62828" : "#b7791f", bold: true }])} />
        )}
        <DescFix sec={sec.content} />

        <SectionBar b={b} title="Images & Social" sub="ALT text and social-share images affect image search, accessibility and shares." rows={images} />
        <IssueTable rows={images} b={b} />
        <DescFix sec={sec.images} />

        <SectionBar b={b} title="Speed & Performance" sub="Speed affects rankings, and every extra second loses visitors." rows={speed} />
        <IssueTable rows={speed} b={b} />
        {deep && deep.speed.length > 0 && (
          <>
            <Tiles b={b} items={[
              { value: String(deep.speed[0].mobile.performance ?? "-"), label: "Mobile performance", color: (deep.speed[0].mobile.performance ?? 0) < 50 ? "#c62828" : "#b7791f", bg: "#fdecea" },
              { value: String(deep.speed[0].desktop.performance ?? "-"), label: "Desktop performance", color: (deep.speed[0].desktop.performance ?? 0) < 50 ? "#c62828" : b.color },
              { value: deep.speed[0].mobile.lcpMs != null ? `${(deep.speed[0].mobile.lcpMs / 1000).toFixed(1)}s` : "-", label: "Mobile LCP (target 2.5s)", bg: "#fbf5e1", color: "#b7791f" },
            ]} />
            <Table b={b} head={["Page", "Mobile", "Desktop", "LCP", "CLS", "Real-user LCP"]} widths={["36%", "12%", "12%", "12%", "12%", "16%"]}
              rows={deep.speed.map((x) => [path(x.url).slice(0, 40), String(x.mobile.performance ?? "-"), String(x.desktop.performance ?? "-"), x.mobile.lcpMs != null ? `${(x.mobile.lcpMs / 1000).toFixed(1)}s` : "-", x.mobile.cls?.toFixed(2) ?? "-", x.mobile.field?.lcpMs != null ? `${(x.mobile.field.lcpMs / 1000).toFixed(1)}s` : "not enough data"])} />
          </>
        )}
        {(deep?.shots?.length ?? 0) > 0 && <Screens shots={deep!.shots!} b={b} />}
        <DescFix sec={sec.speed} />

        <SectionBar b={b} title="Technical & Links" sub="Broken links, redirects and crawl problems waste crawl budget and hurt trust." rows={technical} />
        <IssueTable rows={technical} b={b} />
        {(() => {
          const bl = issues.find((i) => i.code === "broken_links");
          return bl?.links?.length ? <Table b={b} head={["Broken link", "Found on", "Response"]} widths={["50%", "35%", "15%"]} rows={bl.links.slice(0, 10).map((l) => [l.to.replace(/^https?:\/\//, "").slice(0, 60), path(l.from).slice(0, 40), { text: String(l.status ?? "-"), color: "#c62828", bold: true }])} /> : null;
        })()}
        <DescFix sec={sec.technical} />
      </Page>

      {/* Off-page & AI */}
      <Page size="A4" style={s.page}>
        <Chrome b={b} />
        <PartHeader letter="" title="Off-Page Authority & Competitors" b={b} />
        <Tiles b={b} items={[{ value: m?.authority != null ? String(m.authority) : "-", label: "Authority score" }, { value: num(m?.referringDomains), label: "Referring domains", color: b.color }, { value: num(m?.backlinks), label: "Backlinks", color: "#c62828", bg: "#fdecea" }]} />
        <Tiles b={b} items={[{ value: num(m?.traffic), label: "Organic traffic / mo", color: b.color }, { value: num(m?.keywords), label: "Organic keywords", color: b.color }, { value: num(m?.top10), label: "Keywords in top 10", color: b.color }]} />
        {m && m.history.length > 2 && <LineChart b={b} title="Backlinks over the last 12 months" series={m.history.map((h) => ({ date: h.date, value: h.backlinks }))} />}
        {m?.network && m.network.length > 2 && <NetworkGraph b={b} target={crawl.target} domains={m.network} />}
        {m && m.history.length > 2 && <LineChart b={b} title="Referring domains over the last 12 months" series={m.history.map((h) => ({ date: h.date, value: h.referringDomains }))} />}
        <IssueTable rows={offpage} b={b} />
        {(m?.competitors.length ?? 0) > 1 && (
          <>
            <Text style={s.h2}>Competitor Snapshot</Text>
            <Table b={b} head={["Domain", "Organic traffic / mo", "Organic keywords", "Shared keywords"]} widths={["40%", "20%", "20%", "20%"]}
              rows={m!.competitors.map((c) => [{ text: c.domain + (c.you ? " (you)" : ""), bold: !!c.you }, num(c.traffic), num(c.keywords), c.you ? "-" : num(c.intersections)])} />
          </>
        )}
        {!m && <Text style={s.muted}>Off-page data wasn&apos;t available for this audit.</Text>}
        <DescFix sec={sec.offpage} />

        <SectionBar b={b} title="AI / GEO Visibility" sub="Can ChatGPT, Google AI Overviews, Perplexity and Gemini read and cite the business?" rows={ai} />
        <IssueTable rows={ai} b={b} />
        {m?.aiVisibility && (
          <View wrap={false}>
            <Tiles b={b} items={[{ value: num(m.aiVisibility.mentions), label: "Brand mentions in AI answers", color: b.color }, { value: num(m.aiVisibility.cited), label: "Times cited as a source", color: m.aiVisibility.cited ? b.color : "#c62828", bg: m.aiVisibility.cited ? "#eef4f3" : "#fdecea" }]} />
            <Table b={b} head={["AI engine", "Mentions", "Cited"]} widths={["50%", "25%", "25%"]} rows={m.aiVisibility.platforms.map((p) => [p.label, num(p.mentions), { text: num(p.cited), color: p.cited ? "#047857" : "#c62828" }])} />
            {m.aiVisibility.topSources.length > 0 && <Text style={[s.small, { marginBottom: 6 }]}>{clean(`Sites AI engines cite when mentioning the brand: ${m.aiVisibility.topSources.join(", ")}`)}</Text>}
          </View>
        )}
        {deep?.files && (
          <Table b={b} head={["Check", "Result"]} widths={["50%", "50%"]} rows={[
            ["AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended)", { text: deep.files.aiBotsBlocked.length ? `Blocked: ${deep.files.aiBotsBlocked.join(", ")}` : "Allowed", color: deep.files.aiBotsBlocked.length ? "#c62828" : "#047857" }],
            ["llms.txt", { text: deep.files.llmsTxt ? "Found" : "Missing", color: deep.files.llmsTxt ? "#047857" : "#c62828" }],
            ["Business schema on home page", { text: homeSchema.join(", ") || "None", color: homeSchema.length ? "#047857" : "#c62828" }],
            ["Key pages with structured data", `${(deep.schema?.length ?? 0) - noSchema} of ${deep.schema?.length ?? 0}`],
            ...(deep.hreflang && !deep.hreflang.multiLangNoTags ? [["hreflang (languages)", deep.hreflang.problems.length ? `${deep.hreflang.problems.length} problems` : "OK"] as [string, string]] : []),
          ]} />
        )}
        <DescFix sec={sec.ai} />

        {(deep?.ai?.roadmap?.length ?? 0) > 0 && (
          <View>
            <Text style={[s.h2, { marginTop: 14 }]} minPresenceAhead={120}>Website 6-Month Roadmap</Text>
            <Text style={s.p}>A month-by-month plan that front-loads quick high-impact fixes and builds toward content and authority work.</Text>
            <Table b={b} head={["Month", "Focus", "Key tasks", "Expected outcome"]} widths={["12%", "20%", "43%", "25%"]} rows={deep!.ai!.roadmap!.map((r) => [{ text: `Month ${r.month}`, color: b.color, bold: true }, r.focus, r.tasks, r.outcome])} />
            <Text style={[s.small, { fontFamily: "Helvetica-Oblique" }]}>Backlink and review growth run in the background from month 1. Re-audit at the end of month 6 to measure movement.</Text>
          </View>
        )}
      </Page>

      {/* GBP parts */}
      {gbps.map((p, idx) => {
        const info = p.data as unknown as GbpInfo;
        const findings = (p.findings as unknown as GbpFinding[] | null) ?? [];
        const ai = p.ai as unknown as GbpAi | null;
        const fcolor = (f: GbpFinding) => (f.severity === "error" ? "#c62828" : f.severity === "warning" ? "#b7791f" : f.severity === "ok" ? "#047857" : "#2563eb");
        const fmark = (f: GbpFinding) => (f.severity === "error" ? "x" : f.severity === "warning" ? "!" : f.severity === "ok" ? "OK" : "i");
        return (
          <Page key={p.id} size="A4" style={s.page}>
            <Chrome b={b} />
            <PartHeader letter={letters[idx]} title={`GBP Audit - ${p.label} Profile`} b={b} />
            <Text style={s.p}>{clean(ai?.summary || `This profile covers the ${p.label} location. It is ${info.is_claimed ? "claimed" : "not claimed"}${info.rating?.value != null ? ` with a ${info.rating.value} rating from ${info.rating.votes_count ?? 0} reviews` : ""}. Details and findings are specific to this profile.`)}</Text>
            <Table b={b} head={["Field", `Value (${p.label})`]} widths={["28%", "72%"]} rows={[
              ["Business name", info.title ?? "-"], ["Address", info.address ?? "-"], ["Phone", info.phone ?? "-"],
              ["Latitude / Longitude", info.latitude != null ? `${info.latitude}, ${info.longitude}` : "-"],
              ["Business status", { text: info.is_claimed ? "Claimed" : "Not claimed", color: info.is_claimed ? "#047857" : "#c62828", bold: true }],
              ["Reviews / Rating", info.rating?.value != null ? `${info.rating.votes_count ?? 0}  -  ${info.rating.value}` : "-"],
              ["Hours", hoursText(info) || "-"], ["Primary category", info.category ?? "-"],
              ["Other categories", (info.additional_categories ?? []).join(", ") || "-"],
              ["Services", (info.services ?? []).map((x) => x.title).filter(Boolean).slice(0, 10).join(", ") || "-"],
              ["Photos", String(info.total_photos ?? "-")], ["Description", info.description ? `${info.description.length} characters` : "None"],
              ["Place ID", info.place_id ?? "-"], ["CID", info.cid ?? "-"], ["Website", info.url ?? "-"],
              ["Attributes", Object.values(info.attributes?.available_attributes ?? {}).flat().slice(0, 6).join(", ").replace(/_/g, " ") || "-"],
            ]} />
            <Text style={s.h2}>{clean(p.label)} - Findings</Text>
            <Table b={b} dark head={["Issues", "Type"]} widths={["80%", "20%"]} rows={findings.map((f) => [{ text: `${fmark(f)}  ${f.title}`, color: fcolor(f) }, { text: f.severity === "ok" ? "Strength" : f.severity === "info" ? "Check" : SEVL[f.severity], color: fcolor(f) }])} />
            {ai && <DescFix sec={{ description: ai.description, fix: ai.fix }} />}
            <Text style={[s.h2, { fontSize: 10 }]}>Check this business elsewhere</Text>
            {directoryLinks(info).map((l) => <Text key={l.label} style={{ fontSize: 7.5, color: "#2563eb", marginBottom: 1 }}>{clean(`${l.label}: ${l.url}`).slice(0, 130)}</Text>)}
            {(info.people_also_search?.length ?? 0) > 0 && (
              <>
                <Text style={[s.h2, { fontSize: 10 }]}>Competitors Google shows next to this listing</Text>
                <Table b={b} head={["Business", "Rating", "Reviews"]} widths={["60%", "20%", "20%"]} rows={info.people_also_search!.slice(0, 6).map((c) => [c.title ?? "-", String(c.rating?.value ?? "-"), String(c.rating?.votes_count ?? "-")])} />
              </>
            )}
          </Page>
        );
      })}

      {/* Side by side + plan of action */}
      <Page size="A4" style={s.page}>
        <Chrome b={b} />
        {gbps.length > 1 && (
          <View wrap={false}>
            <Text style={[s.h2, { marginTop: 0 }]}>All Profiles - Side by Side</Text>
            <Table b={b} head={["Field", ...gbps.map((p) => p.label)]} widths={["22%", ...gbps.map(() => `${Math.floor(78 / gbps.length)}%`)]} rows={[
              ["Address", ...gbps.map((p) => (p.data as unknown as GbpInfo).address ?? "-")],
              ["Reviews / Rating", ...gbps.map((p) => { const i = p.data as unknown as GbpInfo; return `${i.rating?.votes_count ?? 0} - ${i.rating?.value ?? "-"}`; })],
              ["Website URL", ...gbps.map((p) => path((p.data as unknown as GbpInfo).url ?? "-").split("?")[0])],
              ["Categories", ...gbps.map((p) => { const i = p.data as unknown as GbpInfo; return String(1 + (i.additional_categories?.length ?? 0)); })],
              ["Photos", ...gbps.map((p) => String((p.data as unknown as GbpInfo).total_photos ?? "-"))],
            ]} />
          </View>
        )}
        <PartHeader letter={planLetter} title="Plan of Action" b={b} />
        <Text style={[s.h2, { marginTop: 2 }]}>{planLetter}1 - Website</Text>
        <Table b={b} head={["Priority", "Action", "Benefit"]} widths={["12%", "58%", "30%"]}
          rows={(deep?.ai?.actions ?? []).map((a) => { const pr = pri(a.impact); return [{ text: pr, color: PRIC[pr], bold: true }, a.title, a.why.split(/[.;]/)[0].slice(0, 70)]; })} />
        {gbps.map((p, i) => {
          const ai = p.ai as unknown as GbpAi | null;
          if (!ai?.actions.length) return null;
          return (
            <View key={p.id} wrap={false}>
              <Text style={s.h2}>{planLetter}{i + 2} - GBP {clean(p.label)}</Text>
              <Table b={b} head={["Priority", "Action", "Benefit"]} widths={["12%", "58%", "30%"]} rows={ai.actions.map((a) => [{ text: a.priority, color: PRIC[a.priority], bold: true }, a.action, a.benefit])} />
            </View>
          );
        })}
        <View wrap={false}>
          <PartHeader letter="" title="Audit Conclusion" b={b} />
          <Text style={s.p}>{clean(deep?.ai?.conclusion || `Website: overall score ${overall}/100 (${grade(overall)}).`)}</Text>
          {gbps.map((p) => { const ai = p.ai as unknown as GbpAi | null; return ai?.summary ? <Text key={p.id} style={s.p}>{clean(`GBP ${p.label}: ${ai.summary}`)}</Text> : null; })}
          <Text style={s.p}>Next step: start each plan of action at P1, then work down. We re-audit monthly to track progress.</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function fullAuditPdf(crawl: SiteCrawl, client: { id?: string; name: string; brandPrimaryColor: string | null; logoUrl: string | null }) {
  const color = /^#[0-9a-f]{6}$/i.test(client.brandPrimaryColor ?? "") ? client.brandPrimaryColor! : "#0f7a6c";
  const agency = await getAgency();
  const b: B = { color, dark: "#1f3a37", gold: "#c9a227", agency: agency.name, agencyWebsite: agency.website, logo: await polishLogo(logoForPdf(agency.logo) ?? (await loadLogo(client.logoUrl))), agencyLogo: null, client: client.name };
  // Older reports get their page screenshots now (Google PageSpeed, about 30 seconds).
  const deep = (await ensureShots(crawl).catch(() => null)) ?? (crawl.advanced as unknown as CrawlDeep | null) ?? null;
  const [profiles, prev] = await Promise.all([
    db.gbpProfile.findMany({ where: { clientId: crawl.clientId }, orderBy: { createdAt: "asc" } }),
    db.siteCrawl.findFirst({ where: { clientId: crawl.clientId, status: "DONE", startedAt: { lt: crawl.startedAt } }, orderBy: { startedAt: "desc" }, select: { issues: true } }),
  ]);
  const prevIssues = (prev?.issues as unknown as CrawlIssue[] | null) ?? null;
  try {
    return await renderToBuffer(<Report crawl={crawl} deep={deep} profiles={profiles} b={b} prevIssues={prevIssues} />);
  } catch (e) {
    if (!b.logo && !b.agencyLogo) throw e;
    console.error("Full audit PDF failed with a logo, retrying without:", e);
    return renderToBuffer(<Report crawl={crawl} deep={deep} profiles={profiles} b={{ ...b, logo: null, agencyLogo: null }} prevIssues={prevIssues} />);
  }
}
