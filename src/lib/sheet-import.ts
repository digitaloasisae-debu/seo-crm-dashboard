/**
 * Import from the "Blog Automation - Client Data" Google Sheet, downloaded as .xlsx.
 *
 * Tabs used: "Client Config", "Keyword Pool - <client>", "Topic Queue - <client>". Google cuts tab
 * names at 31 characters, so tabs are matched to clients by prefix. Re-running is safe: clients are
 * matched by name, keywords by (client, keyword), topics by (client, keyword, title).
 */
import ExcelJS from "exceljs";
import { db } from "./db";
import { encryptSecret } from "./crypto";
import { logActivity } from "./activity";
import { ensureSlots } from "./posting";
import { normalizeKeyword, slugify, splitList, stripTrailingSlash, yes } from "./utils";

type Row = Record<string, string>;
type Tabs = Map<string, Row[]>;

export type ImportReport = {
  mode: "preview" | "import";
  clients: { name: string; isNew: boolean; owner: string | null; wordpress: boolean; keywords: number; topics: number; drafted: number }[];
  totals: { clients: number; newClients: number; credentials: number; keywords: number; topics: number; drafted: number; assignments: number };
  owners: { name: string; account: string | null }[];
  problems: string[];
};

// ---------- Reading the workbook ----------

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) {
      const t = v.text as unknown;
      if (typeof t === "string") return t;
      if (t && typeof t === "object" && "richText" in t) return (t.richText as { text: string }[]).map((x) => x.text).join("");
    }
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("error" in v) return "";
  }
  return String(v);
}

export async function readWorkbook(data: ArrayBuffer): Promise<Tabs> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const tabs: Tabs = new Map();
  wb.eachSheet((ws) => {
    const header: string[] = [];
    const rows: Row[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const values = row.values as ExcelJS.CellValue[]; // 1-based
      if (n === 1 || header.length === 0) {
        values.forEach((v, i) => (header[i] = cellText(v).trim()));
        return;
      }
      const r: Row = {};
      values.forEach((v, i) => {
        if (header[i]) r[header[i]] = cellText(v).trim();
      });
      if (Object.values(r).some(Boolean)) rows.push(r);
    });
    tabs.set(ws.name.trim(), rows);
  });
  return tabs;
}

const pick = (r: Row, ...keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(r).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    if (hit && r[hit]) return r[hit].trim();
  }
  return "";
};
const date = (s: string) => {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(+d) ? undefined : d;
};
const int = (s: string) => {
  const n = parseInt(s.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const color = (blob: string, label: string) => blob.match(new RegExp(`${label}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, "i"))?.[1] ?? null;

/** Find "<prefix> - <client>" even when Google cut the tab name short. */
function findTab(tabs: Tabs, prefix: string, client: string) {
  const want = client.toLowerCase().replace(/\s+/g, " ").trim();
  let best: { name: string; rows: Row[]; len: number } | null = null;
  for (const [name, rows] of tabs) {
    const m = name.match(new RegExp(`^${prefix}\\s*-\\s*(.+)$`, "i"));
    if (!m) continue;
    const suffix = m[1].toLowerCase().replace(/\s+/g, " ").trim();
    if (suffix.length < 4) continue;
    if (want === suffix || want.startsWith(suffix) || suffix.startsWith(want)) {
      if (!best || suffix.length > best.len) best = { name, rows, len: suffix.length };
    }
  }
  return best;
}

// ---------- Planning and running ----------

export async function importSheet(tabs: Tabs, opts: { commit: boolean; actorId?: string }): Promise<ImportReport> {
  const report: ImportReport = {
    mode: opts.commit ? "import" : "preview",
    clients: [],
    totals: { clients: 0, newClients: 0, credentials: 0, keywords: 0, topics: 0, drafted: 0, assignments: 0 },
    owners: [],
    problems: [],
  };

  const configName = [...tabs.keys()].find((n) => /^client config$/i.test(n));
  if (!configName) {
    report.problems.push('No "Client Config" tab found. Is this the right file?');
    return report;
  }

  const users = await db.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true } });
  const findUser = (who: string) => {
    const w = who.trim().toLowerCase();
    if (!w) return null;
    return (
      users.find((u) => u.email.toLowerCase() === w || u.name.toLowerCase() === w) ??
      users.find((u) => u.name.toLowerCase().split(/\s+/)[0] === w.split(/\s+/)[0]) ??
      null
    );
  };
  const ownerSeen = new Map<string, string | null>();
  const usedTabs = new Set<string>([configName]);

  for (const r of tabs.get(configName)!) {
    const name = pick(r, "client_name").replace(/\s+/g, " ");
    const siteUrl = stripTrailingSlash(pick(r, "site_url"));
    if (!name || !siteUrl) {
      if (name || siteUrl) report.problems.push(`Skipped a Client Config row without a name or site_url (${name || siteUrl}).`);
      continue;
    }
    const brand = pick(r, "Branding colors");
    const data = {
      name,
      siteUrl,
      servicesOffered: splitList(pick(r, "Services Offered")),
      targetAudience: pick(r, "Target Audience") || null,
      competitors: splitList(pick(r, "Competitors")),
      businessType: pick(r, "business_type") || null,
      targetCountry: pick(r, "target_country") || null,
      primaryCity: pick(r, "primary_city") || null,
      serviceAreaCities: splitList(pick(r, "service_area_cities")),
      brandVoiceAvoid: pick(r, "brand_voice_avoid") || null,
      ctaText: pick(r, "cta_text") || null,
      ctaLink: pick(r, "CTA Link") || null,
      postsPerMonth: int(pick(r, "posts_per_month")) ?? 0,
      preferredDates: splitList(pick(r, "posting_dates")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      imageRequired: yes(pick(r, "Is image generation required?")),
      imageStyle: pick(r, "image_style") || null,
      cmsPlatform: pick(r, "cms_platform") || null,
      cmsPreviewSupported: yes(pick(r, "cms_preview_supported")),
      linkPool: splitList(pick(r, "sitemap_or_key_pages")),
      socialLinks: splitList(pick(r, "External Links")),
      masterTemplateUrl: pick(r, "master_template_url") || null,
      gscAccount: pick(r, "gsc_account") || null,
      submittedBy: pick(r, "Submitted By") || null,
      brandPrimaryColor: color(brand, "primary color"),
      brandSecondaryColor: color(brand, "secondary color"),
      brandAccentColor: color(brand, "accent color"),
      logoUrl: brand.match(/logo url:\s*(https?:\/\/\S+)/i)?.[1] ?? null,
    };

    const endpoint = stripTrailingSlash(pick(r, "wordpress_draft_endpoint")).replace(/([^:])\/{2,}/g, "$1/");
    const username = pick(r, "wordpress username");
    const password = pick(r, "wordpress app password");
    const hasCred = Boolean(endpoint && username && password);
    if (!hasCred) report.problems.push(`${name}: WordPress login incomplete in the sheet. Add it on the client's Settings page.`);

    const owner = data.submittedBy ? findUser(data.submittedBy) : null;
    if (data.submittedBy && !ownerSeen.has(data.submittedBy)) ownerSeen.set(data.submittedBy, owner ? `${owner.name} (${owner.email})` : null);

    // Keywords
    const kwTab = findTab(tabs, "Keyword Pool", name);
    if (kwTab) usedTabs.add(kwTab.name);
    else report.problems.push(`${name}: no "Keyword Pool" tab found.`);
    const seen = new Set<string>();
    const keywords = (kwTab?.rows ?? [])
      .filter((k) => pick(k, "keyword"))
      .map((k) => {
        const keyword = pick(k, "keyword").replace(/\s+/g, " ");
        const status = pick(k, "status").toLowerCase();
        return {
          keyword,
          keywordNorm: normalizeKeyword(keyword),
          category: pick(k, "category") || null,
          searchVolume: int(pick(k, "search_volume")),
          difficulty: int(pick(k, "difficulty")),
          volumeVerified: yes(pick(k, "volume_verified")),
          // Keywords come from the team, so blank status counts as approved (same rule as Tally keywords).
          status: status === "rejected" ? ("REJECTED" as const) : status === "pending" ? ("PENDING" as const) : ("APPROVED" as const),
          used: yes(pick(k, "used")),
          usedAt: date(pick(k, "date_used")),
          addedAt: date(pick(k, "date_added")) ?? new Date(),
          source: "IMPORT" as const,
        };
      })
      .filter((k) => !seen.has(k.keywordNorm) && seen.add(k.keywordNorm));

    // Topics
    const tqTab = findTab(tabs, "Topic Queue", name);
    if (tqTab) usedTabs.add(tqTab.name);
    else report.problems.push(`${name}: no "Topic Queue" tab found.`);
    const topics = (tqTab?.rows ?? [])
      .filter((t) => pick(t, "keyword") && pick(t, "topic"))
      .map((t) => {
        const topicStatus = pick(t, "topic_status").toLowerCase();
        const drafted = pick(t, "blog_status").toLowerCase() === "drafted";
        return {
          keyword: pick(t, "keyword").replace(/\s+/g, " "),
          title: pick(t, "topic"),
          category: pick(t, "category") || null,
          angle: pick(t, "angle") || null,
          secondaryKeywords: splitList(pick(t, "secondary_keywords")),
          status: drafted || topicStatus === "approved" ? ("APPROVED" as const) : topicStatus === "rejected" ? ("REJECTED" as const) : ("GENERATED" as const),
          generatedAt: date(pick(t, "date_generated")) ?? new Date(),
          drafted,
          wpUrl: pick(t, "wordpress_post_url") || null,
        };
      });

    const existing = await db.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    const drafted = topics.filter((t) => t.drafted).length;
    report.clients.push({ name, isNew: !existing, owner: owner?.name ?? null, wordpress: hasCred, keywords: keywords.length, topics: topics.length, drafted });
    report.totals.clients++;
    if (!existing) report.totals.newClients++;
    if (hasCred) report.totals.credentials++;
    report.totals.keywords += keywords.length;
    report.totals.topics += topics.length;
    report.totals.drafted += drafted;
    if (owner && owner.role !== "SUPER_ADMIN") report.totals.assignments++;

    if (!opts.commit) continue;

    // ---- write ----
    const client = existing
      ? await db.client.update({ where: { id: existing.id }, data })
      : await db.client.create({ data: { ...data, slug: await uniqueSlug(name) } });
    const clientId = client.id;

    if (hasCred) {
      const sealed = encryptSecret(password);
      await db.clientCredential.upsert({
        where: { clientId_kind: { clientId, kind: "WORDPRESS" } },
        create: { clientId, kind: "WORDPRESS", endpoint, username, ...sealed },
        update: { endpoint, username, ...sealed, lastVerifiedAt: null, lastError: null },
      });
    }
    if (owner && owner.role !== "SUPER_ADMIN") {
      await db.clientAssignment.upsert({
        where: { clientId_userId: { clientId, userId: owner.id } },
        create: { clientId, userId: owner.id, access: "OWNER" },
        update: {},
      });
    }

    if (keywords.length) await db.keyword.createMany({ data: keywords.map((k) => ({ ...k, clientId })), skipDuplicates: true });
    const kwRows = await db.keyword.findMany({ where: { clientId }, select: { id: true, keywordNorm: true } });
    const kwId = new Map(kwRows.map((k) => [k.keywordNorm, k.id]));

    const have = await db.topic.findMany({ where: { clientId }, select: { keyword: true, title: true } });
    const haveKey = new Set(have.map((t) => `${t.keyword.toLowerCase()}|${t.title.toLowerCase()}`));
    const fresh = topics.filter((t) => {
      const key = `${t.keyword.toLowerCase()}|${t.title.toLowerCase()}`;
      if (haveKey.has(key)) return false;
      haveKey.add(key);
      return true;
    });
    if (fresh.length) {
      await db.topic.createMany({
        data: fresh.map((t) => ({
          clientId,
          keywordId: kwId.get(normalizeKeyword(t.keyword)) ?? null,
          keyword: t.keyword,
          title: t.title,
          category: t.category,
          angle: t.angle,
          secondaryKeywords: t.secondaryKeywords,
          status: t.status,
          generatedAt: t.generatedAt,
        })),
      });
      // Topics already drafted in WordPress get an article record so they are never written twice.
      const draftedFresh = fresh.filter((t) => t.drafted);
      if (draftedFresh.length) {
        const created = await db.topic.findMany({ where: { clientId, article: null }, select: { id: true, keyword: true, title: true } });
        const byKey = new Map(created.map((t) => [`${t.keyword.toLowerCase()}|${t.title.toLowerCase()}`, t.id]));
        const articles = draftedFresh
          .map((t) => ({ t, topicId: byKey.get(`${t.keyword.toLowerCase()}|${t.title.toLowerCase()}`) }))
          .filter((x): x is { t: (typeof draftedFresh)[number]; topicId: string } => Boolean(x.topicId))
          .map(({ t, topicId }) => ({
            clientId,
            topicId,
            metaTitle: t.title,
            slug: slugify(t.title),
            focusKeyword: t.keyword,
            bodyHtml: `<p>Imported from the Google Sheet. This article was already drafted in WordPress${t.wpUrl ? `: <a href="${t.wpUrl}">${t.wpUrl}</a>` : ""}.</p>`,
            status: "PUSHED_DRAFT" as const,
            wpPostUrl: t.wpUrl,
          }));
        if (articles.length) await db.article.createMany({ data: articles, skipDuplicates: true });
      }
    }
    await ensureSlots(clientId);
    await logActivity({ actorId: opts.actorId, actorTag: "sheet-import", clientId, action: existing ? "client.update_from_sheet" : "client.import", entity: "client", entityId: clientId, after: { keywords: keywords.length, topics: fresh.length } });
  }

  report.owners = [...ownerSeen].map(([name, account]) => ({ name, account }));
  for (const o of report.owners) {
    if (!o.account) report.problems.push(`"${o.name}" (Submitted By) has no team account yet, so their clients won't be assigned to them. Add them on the Team page first, then import again.`);
  }
  const skipped = [...tabs.keys()].filter((n) => !usedTabs.has(n));
  if (skipped.length) report.problems.push(`Not imported (not used by the dashboard yet): ${skipped.join(", ")}.`);
  return report;
}

async function uniqueSlug(name: string) {
  const base = slugify(name) || "client";
  let slug = base;
  for (let i = 2; await db.client.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  return slug;
}
