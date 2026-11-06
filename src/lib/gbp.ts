/**
 * Google Business Profile audit: pulls each listing's public details from DataForSEO
 * (business_data/google/my_business_info), checks them against the website and against each other,
 * and writes an AI summary and plan of action per profile.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { dfsPost } from "./dataforseo";
import { geminiConfigured, geminiJson } from "./gemini";

type Time = { hour: number; minute: number };
export type GbpInfo = {
  title?: string; original_title?: string; description?: string | null; category?: string | null; additional_categories?: string[] | null;
  phone?: string | null; url?: string | null; domain?: string | null; address?: string | null;
  address_info?: { address?: string; city?: string; zip?: string; region?: string; country_code?: string } | null;
  latitude?: number | null; longitude?: number | null; is_claimed?: boolean | null; total_photos?: number | null;
  place_id?: string | null; cid?: string | null; feature_id?: string | null; main_image?: string | null; logo?: string | null;
  rating?: { value?: number | null; votes_count?: number | null } | null;
  rating_distribution?: Record<string, number> | null;
  work_time?: { work_hours?: { timetable?: Record<string, { open: Time; close: Time }[] | null> | null; current_status?: string | null } | null } | null;
  attributes?: { available_attributes?: Record<string, string[]> | null; unavailable_attributes?: Record<string, string[]> | null } | null;
  services?: { category?: string; title?: string }[] | null;
  people_also_search?: { title?: string; cid?: string; rating?: { value?: number; votes_count?: number } | null }[] | null;
  place_topics?: Record<string, number> | null;
  check_url?: string;
};
export type GbpFinding = { severity: "error" | "warning" | "info" | "ok"; title: string; detail: string };
export type GbpAi = { summary: string; description: string[]; fix: string[]; actions: { priority: "P1" | "P2" | "P3"; action: string; benefit: string }[] };

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (t: Time) => { const h = t.hour % 12 || 12; return `${h}${t.minute ? `:${pad(t.minute)}` : ""}${t.hour < 12 ? "AM" : "PM"}`; };

/** "Mon–Thu 8AM–5PM, Fri 8AM–4PM, Sat/Sun closed" style summary of the opening hours. */
export function hoursText(info: GbpInfo) {
  const tt = info.work_time?.work_hours?.timetable;
  if (!tt) return "";
  const per = DAYS.map((d) => ({ d, v: (tt[d] ?? []).map((x) => `${fmtTime(x.open)}–${fmtTime(x.close)}`).join(", ") || "closed" }));
  const groups: { from: string; to: string; v: string }[] = [];
  for (const p of per) {
    const last = groups[groups.length - 1];
    if (last && last.v === p.v) last.to = p.d; else groups.push({ from: p.d, to: p.d, v: p.v });
  }
  const cap = (d: string) => d[0].toUpperCase() + d.slice(1, 3);
  return groups.map((g) => `${g.from === g.to ? cap(g.from) : `${cap(g.from)}–${cap(g.to)}`} ${g.v}`).join(", ");
}

/** Works out what the user pasted: a Maps link (incl. short links), a CID, a place ID, or a business name. */
export async function parseGbpQuery(raw: string): Promise<{ keyword: string; cid?: string; placeId?: string; name?: string }> {
  let q = raw.trim();
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google)\//i.test(q)) {
    for (let i = 0; i < 4; i++) {
      const r = await fetch(q, { redirect: "manual", signal: AbortSignal.timeout(8_000) }).catch(() => null);
      const loc = r?.headers.get("location");
      if (!loc) break;
      q = new URL(loc, q).toString();
    }
  }
  const dec = (() => { try { return decodeURIComponent(q); } catch { return q; } })();
  const cid = dec.match(/[?&]cid=(\d{6,})/)?.[1] ?? dec.match(/[?&]ludocid=(\d{6,})/)?.[1];
  if (cid) return { keyword: `cid:${cid}`, cid };
  const hex = dec.match(/0x[0-9a-f]+:0x([0-9a-f]+)/i)?.[1];
  if (hex) { const c = BigInt(`0x${hex}`).toString(); return { keyword: `cid:${c}`, cid: c }; }
  const pid = dec.match(/(?:place_id[:=]|query_place_id=)([A-Za-z0-9_-]{20,})/)?.[1];
  if (pid) return { keyword: `place_id:${pid}`, placeId: pid };
  if (/^\d{8,22}$/.test(q)) return { keyword: `cid:${q}`, cid: q };
  if (/^ChI[A-Za-z0-9_-]{15,}$/.test(q)) return { keyword: `place_id:${q}`, placeId: q };
  const name = dec.match(/\/maps\/place\/([^/@?]+)/)?.[1]?.replace(/\+/g, " ");
  return { keyword: name ?? q, name: name ?? q };
}

async function fetchInfo(keyword: string, location: string): Promise<GbpInfo | null> {
  const r = await dfsPost<{ items?: GbpInfo[] }>("business_data/google/my_business_info/live", [{ keyword, location_name: location, language_code: "en" }], 60_000);
  return r[0]?.items?.[0] ?? null;
}

const digits = (s: string) => s.replace(/\D/g, "");
const host = (u: string) => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** Does the page the profile links to show the same phone number and street address? */
async function napOnSite(info: GbpInfo) {
  if (!info.url) return null;
  try {
    const res = await fetch(info.url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; RankflowAudit/1.0)" }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { status: res.status, phone: false, address: false, finalUrl: res.url };
    const html = (await res.text()).replace(/<script[\s\S]*?<\/script>/gi, " ");
    const phone = info.phone ? digits(info.phone).slice(-10) : "";
    const street = (info.address_info?.address ?? info.address ?? "").split(",")[0].trim();
    const num = street.match(/^\d+/)?.[0];
    const word = street.replace(/^\d+\s*/, "").split(/\s+/)[0] ?? "";
    return {
      status: res.status, finalUrl: res.url,
      phone: !!phone && digits(html).includes(phone),
      address: !!num && html.includes(num) && (!word || html.toLowerCase().includes(word.toLowerCase())),
    };
  } catch {
    return null;
  }
}

/** Rule-based checks on one listing, plus the ones that compare it with the client's other listings. */
export function gbpFindings(info: GbpInfo, ctx: { siteHost: string; clientName: string; others: { label: string; info: GbpInfo }[]; nap: Awaited<ReturnType<typeof napOnSite>> }): GbpFinding[] {
  const f: GbpFinding[] = [];
  const rating = info.rating?.value ?? null;
  const votes = info.rating?.votes_count ?? 0;
  const status = info.work_time?.work_hours?.current_status;
  if (status === "closed_forever") f.push({ severity: "error", title: "Marked as permanently closed", detail: "Google shows this listing as closed for good. Reopen it in the Business Profile Manager." });
  else if (status === "temporarily_closed") f.push({ severity: "error", title: "Marked as temporarily closed", detail: "Customers see 'Temporarily closed'. Update the status if the business is open." });
  if (info.is_claimed === false) f.push({ severity: "error", title: "Profile is not claimed", detail: "Anyone can suggest edits. Claim it at business.google.com and verify." });
  if (!info.phone) f.push({ severity: "error", title: "No phone number", detail: "Add the main business number so customers can call from Maps." });
  if (!info.url) f.push({ severity: "error", title: "No website link", detail: "Add the website (ideally the matching city/location page)." });
  else {
    const h = host(info.url);
    if (ctx.siteHost && h && h !== ctx.siteHost) f.push({ severity: "warning", title: "Website points to a different domain", detail: `Links to ${h}, not ${ctx.siteHost}.` });
    let p = "/";
    try { p = new URL(info.url).pathname; } catch { /* keep "/" */ }
    if (ctx.others.length && (p === "/" || p === "")) f.push({ severity: "warning", title: "Website points to the home page, not a location page", detail: "With several locations, each profile should link to its own city page." });
    if (ctx.others.some((o) => o.info.url && o.info.url.split("?")[0] === info.url!.split("?")[0])) f.push({ severity: "warning", title: "Same website URL as another profile", detail: "Two listings sending visitors to the same page split local relevance." });
    if (!/utm_/i.test(info.url)) f.push({ severity: "info", title: "Website link has no UTM tracking", detail: "Add ?utm_source=gbp&utm_medium=organic so Google Analytics shows Maps visits separately." });
    if (ctx.nap) {
      if (ctx.nap.status >= 400) f.push({ severity: "error", title: `Linked page returns ${ctx.nap.status}`, detail: "The website link on the profile is broken." });
      else {
        if (info.phone && !ctx.nap.phone) f.push({ severity: "warning", title: "Phone number not found on the linked page", detail: `${info.phone} isn't shown on ${info.url}. Name, address and phone should match exactly.` });
        if ((info.address_info?.address || info.address) && !ctx.nap.address) f.push({ severity: "warning", title: "Address not found on the linked page", detail: "Show the same street address as the profile on the location page (and in LocalBusiness schema)." });
      }
    }
  }
  if (rating != null && rating < 4.3) f.push({ severity: "warning", title: `Rating is ${rating}`, detail: "Below the 4.3+ most customers filter for. Reply to negative reviews and ask happy customers for reviews." });
  const comp = (info.people_also_search ?? []).map((c) => c.rating?.votes_count ?? 0).filter((n) => n > 0);
  const compAvg = comp.length ? Math.round(comp.reduce((a, b) => a + b, 0) / comp.length) : null;
  if (votes < 10) f.push({ severity: "warning", title: `Only ${votes} review${votes === 1 ? "" : "s"}`, detail: `Reviews are a top local ranking factor${compAvg ? `; nearby competitors average ${compAvg}` : ""}. Set up a review request after every job.` });
  else if (compAvg && votes < compAvg * 0.6) f.push({ severity: "info", title: `Fewer reviews than nearby competitors (${votes} vs ~${compAvg})`, detail: "Keep a steady flow of new reviews to close the gap." });
  if (!info.description || info.description.trim().length < 250) f.push({ severity: "warning", title: info.description ? "Business description is short" : "No business description", detail: "Use most of the 750 characters: services, areas served, what makes the business different." });
  if (!info.work_time?.work_hours?.timetable) f.push({ severity: "warning", title: "No opening hours", detail: "Add regular hours; profiles without hours rank and convert worse." });
  if ((info.total_photos ?? 0) < 10) f.push({ severity: "warning", title: `Only ${info.total_photos ?? 0} photos`, detail: "Upload real project, team and location photos (aim for 30+, a few new ones every month)." });
  const cats = [info.category, ...(info.additional_categories ?? [])].filter(Boolean) as string[];
  if (!info.additional_categories?.length) f.push({ severity: "warning", title: "No secondary categories", detail: "Add the other services the business offers as additional categories." });
  for (const o of ctx.others) {
    const oc = [o.info.category, ...(o.info.additional_categories ?? [])].filter(Boolean) as string[];
    if (cats.length > 1 && oc.length === cats.length && oc.every((c) => cats.includes(c))) { f.push({ severity: "warning", title: `Category list identical to the ${o.label} profile`, detail: "Tailor each location's categories to what that office actually offers." }); break; }
  }
  if (!info.services?.length) f.push({ severity: "info", title: "No services listed", detail: "Add each service with a short description in the Services section." });
  const name = (info.title ?? "").toLowerCase();
  const brand = ctx.clientName.toLowerCase().replace(/\b(llc|inc|ltd|group|co)\b\.?/g, "").trim();
  if (brand && name && !name.includes(brand.split(" ")[0])) f.push({ severity: "info", title: "Listing name differs from the brand name", detail: `Google shows "${info.title}". Check it matches the real business name on the website and directories.` });
  if (/[|\-–]\s*\w+/.test(info.title ?? "") && (info.title ?? "").split(/\s+/).length > 5) f.push({ severity: "warning", title: "Name may contain extra keywords", detail: "Adding cities or services to the name breaks Google's rules and risks suspension. Use the real business name only." });
  const okBits = [info.is_claimed ? "Claimed" : "", rating != null && votes ? `${rating} rating from ${votes} reviews` : "", info.work_time?.work_hours?.timetable ? "hours set" : "", info.description ? "description" : ""].filter(Boolean);
  if (okBits.length) f.push({ severity: "ok", title: okBits.join(", "), detail: "" });
  return f;
}

/** Map and directory links for checking the listing elsewhere (Apple, Bing, Yelp, Facebook). */
export function directoryLinks(info: GbpInfo) {
  const name = encodeURIComponent(info.title ?? "");
  const ll = info.latitude != null && info.longitude != null ? `${info.latitude},${info.longitude}` : "";
  const city = encodeURIComponent(info.address_info?.city ?? "");
  return [
    { label: "Google Maps", url: info.cid ? `https://maps.google.com/?cid=${info.cid}` : `https://www.google.com/maps/search/${name}` },
    ...(ll ? [{ label: "Apple Maps", url: `https://maps.apple.com/?q=${name}&near=${ll}` }, { label: "Bing Maps", url: `https://www.bing.com/maps?q=${name}&cp=${ll.replace(",", "~")}` }] : []),
    { label: "Yelp", url: `https://www.yelp.com/search?find_desc=${name}&find_loc=${city}` },
    { label: "Facebook", url: `https://www.facebook.com/search/places/?q=${name}` },
    ...(info.place_id ? [{ label: "Review link", url: `https://search.google.com/local/writereview?placeid=${info.place_id}` }] : []),
  ];
}

/** Re-fetches every profile of a client, runs the checks and writes the AI plan. */
export async function refreshGbp(clientId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, siteUrl: true, targetCountry: true, primaryCity: true, businessType: true } });
  const profiles = await db.gbpProfile.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
  const location = client.targetCountry?.trim() || process.env.DATAFORSEO_DEFAULT_COUNTRY || "United States";
  const fetched = await Promise.all(profiles.map(async (p) => {
    try {
      const q = await parseGbpQuery(p.query);
      const info = await fetchInfo(q.keyword, location);
      if (!info) throw new Error("Google didn't return a business for this. Paste the Google Maps link of the listing instead.");
      return { p, info, error: null as string | null };
    } catch (e) {
      return { p, info: (p.data as unknown as GbpInfo | null) ?? null, error: e instanceof Error ? e.message : String(e) };
    }
  }));
  const ok = fetched.filter((x) => x.info) as { p: (typeof profiles)[number]; info: GbpInfo; error: string | null }[];
  const naps = await Promise.all(ok.map((x) => napOnSite(x.info)));
  const siteHost = host(client.siteUrl);
  const results = ok.map((x, i) => ({ ...x, findings: gbpFindings(x.info, { siteHost, clientName: client.name, others: ok.filter((o) => o !== x).map((o) => ({ label: o.p.label, info: o.info })), nap: naps[i] }) }));

  let ai: Record<string, GbpAi> = {};
  if (geminiConfigured() && results.length) {
    try { ai = await gbpAi(client, results.map((r) => ({ id: r.p.id, label: r.p.label, info: r.info, findings: r.findings }))); } catch { ai = {}; }
  }
  for (const x of fetched) {
    const r = results.find((y) => y.p.id === x.p.id);
    await db.gbpProfile.update({
      where: { id: x.p.id },
      data: {
        error: x.error,
        ...(r ? {
          data: r.info as unknown as Prisma.InputJsonValue, findings: r.findings as unknown as Prisma.InputJsonValue,
          cid: r.info.cid ?? x.p.cid, placeId: r.info.place_id ?? x.p.placeId, fetchedAt: x.error ? x.p.fetchedAt : new Date(),
          ...(ai[x.p.id] ? { ai: ai[x.p.id] as unknown as Prisma.InputJsonValue } : {}),
        } : {}),
      },
    });
  }
  return results.length;
}

async function gbpAi(client: { name: string; businessType: string | null; primaryCity: string | null }, list: { id: string; label: string; info: GbpInfo; findings: GbpFinding[] }[]) {
  const facts = list.map((x) => [
    `PROFILE id=${x.id} label="${x.label}"`,
    `Name: ${x.info.title}; category: ${x.info.category}; extra categories: ${(x.info.additional_categories ?? []).join(", ") || "none"}`,
    `Address: ${x.info.address}; phone: ${x.info.phone}; website: ${x.info.url}`,
    `Claimed: ${x.info.is_claimed}; rating ${x.info.rating?.value ?? "n/a"} from ${x.info.rating?.votes_count ?? 0} reviews; photos ${x.info.total_photos ?? 0}; hours: ${hoursText(x.info) || "none"}; description: ${x.info.description ? `${x.info.description.length} chars` : "none"}; services: ${(x.info.services ?? []).length}`,
    `Nearby competitors: ${(x.info.people_also_search ?? []).slice(0, 5).map((c) => `${c.title} (${c.rating?.value ?? "?"}, ${c.rating?.votes_count ?? 0} reviews)`).join("; ") || "unknown"}`,
    `Findings: ${x.findings.filter((f) => f.severity !== "ok").map((f) => `[${f.severity}] ${f.title}`).join("; ") || "none"}`,
  ].join("\n")).join("\n\n");
  const r = await geminiJson<{ profiles: ({ id: string } & GbpAi)[] }>(`Business: ${client.name}${client.businessType ? `, ${client.businessType}` : ""}${client.primaryCity ? `, ${client.primaryCity}` : ""}\n\n${facts}`, {
    system: `You are a local SEO specialist auditing Google Business Profiles for a client report. Plain English for a business owner.
Return JSON: {"profiles": [{"id": string, "summary": string, "description": string[], "fix": string[], "actions": [{"priority": "P1"|"P2"|"P3", "action": string, "benefit": string}]}]}
- one entry per PROFILE id given.
- summary: 1-2 sentences on the overall state of this profile.
- description: 2-4 short sentences describing the problems found (and strengths), using the real numbers.
- fix: 2-4 short sentences, one per fix, matching the problems.
- actions: 4-6 actions in priority order. P1 = urgent/high impact, P2 = important, P3 = ongoing. benefit: 2-5 words.
When there are several profiles, address overlap between them (same categories, same website page) explicitly.
Only use the facts given. Never invent numbers.`,
    timeoutMs: 55_000, temperature: 0.3,
  });
  const pr = new Set(["P1", "P2", "P3"]);
  return Object.fromEntries((r.profiles ?? []).filter((p) => p?.id).map((p) => [p.id, {
    summary: String(p.summary ?? ""),
    description: (p.description ?? []).map(String).slice(0, 5),
    fix: (p.fix ?? []).map(String).slice(0, 5),
    actions: (p.actions ?? []).slice(0, 7).map((a) => ({ priority: (pr.has(a.priority) ? a.priority : "P2") as GbpAi["actions"][number]["priority"], action: String(a.action ?? ""), benefit: String(a.benefit ?? "") })),
  }]));
}
