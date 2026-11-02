/**
 * One-time import from the "Blog Automation - Client Data" Google Sheet.
 *
 * 1. In Google Sheets, export each tab as CSV (File > Download > CSV) into ./imports/:
 *      Client Config.csv
 *      Keyword Pool - <Client Name>.csv
 *      Topic Queue - <Client Name>.csv
 * 2. Dry run (no writes):   npm run import:sheets
 *    Real import:           npm run import:sheets -- --commit
 *
 * WordPress app passwords are encrypted on the way in. Re-running is safe: clients are matched
 * by name, keywords by (client, keyword), topics by (client, keyword, title).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/crypto";
import { normalizeKeyword, slugify, splitList, stripTrailingSlash, yes } from "../src/lib/utils";

const db = new PrismaClient();
const DIR = join(process.cwd(), "imports");
const COMMIT = process.argv.includes("--commit");

type Row = Record<string, string>;
const read = (file: string): Row[] => parse(readFileSync(join(DIR, file)), { columns: true, skip_empty_lines: true, trim: true, bom: true });
const pick = (r: Row, ...keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(r).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    if (hit && r[hit]) return r[hit].trim();
  }
  return "";
};
const date = (s: string) => {
  const d = new Date(s);
  return isNaN(+d) ? undefined : d;
};
const color = (blob: string, label: string) => blob.match(new RegExp(`${label}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, "i"))?.[1];
const safeTab = (name: string) => name.replace(/[[\]*?/\\:]/g, "").trim().substring(0, 80);

const report = { clients: 0, credentials: 0, keywords: 0, topics: 0, articles: 0, problems: [] as string[] };

async function main() {
  const files = readdirSync(DIR);
  const configFile = files.find((f) => /^client config/i.test(f));
  if (!configFile) throw new Error(`No "Client Config.csv" in ${DIR}`);

  for (const r of read(configFile)) {
    const name = pick(r, "client_name");
    const siteUrl = stripTrailingSlash(pick(r, "site_url"));
    if (!name || !siteUrl) {
      report.problems.push(`Client row skipped (missing name or site_url): ${JSON.stringify(r).slice(0, 120)}`);
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
      postsPerMonth: Number(pick(r, "posts_per_month")) || 0,
      preferredDates: splitList(pick(r, "posting_dates")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      imageRequired: yes(pick(r, "Is image generation required?")),
      imageStyle: pick(r, "image_style") || null,
      cmsPlatform: pick(r, "cms_platform") || null,
      cmsPreviewSupported: yes(pick(r, "cms_preview_supported")),
      linkPool: splitList(pick(r, "sitemap_or_key_pages")),
      socialLinks: splitList(pick(r, "External Links")),
      masterTemplateUrl: pick(r, "master_template_url") || null,
      gscAccount: pick(r, "gsc_account") || null,
      brandPrimaryColor: color(brand, "primary color") ?? null,
      brandSecondaryColor: color(brand, "secondary color") ?? null,
      brandAccentColor: color(brand, "accent color") ?? null,
      logoUrl: brand.match(/logo url:\s*(\S+)/i)?.[1] ?? null,
    };
    report.clients++;

    const endpoint = stripTrailingSlash(pick(r, "wordpress_draft_endpoint"));
    const username = pick(r, "wordpress username");
    const password = pick(r, "wordpress app password");
    if (!endpoint || !username || !password) report.problems.push(`${name}: WordPress credentials incomplete, add them in Settings`);

    let clientId = "dry-run";
    if (COMMIT) {
      const existing = await db.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
      const client = existing
        ? await db.client.update({ where: { id: existing.id }, data })
        : await db.client.create({ data: { ...data, slug: await uniqueSlug(name) } });
      clientId = client.id;
      if (endpoint && username && password) {
        const sealed = encryptSecret(password);
        await db.clientCredential.upsert({
          where: { clientId_kind: { clientId, kind: "WORDPRESS" } },
          create: { clientId, kind: "WORDPRESS", endpoint, username, ...sealed },
          update: { endpoint, username, ...sealed },
        });
      }
    }
    if (endpoint && username && password) report.credentials++;

    const kwFile = files.find((f) => f.toLowerCase() === `keyword pool - ${safeTab(name)}.csv`.toLowerCase());
    if (kwFile) await importKeywords(clientId, read(kwFile));
    else report.problems.push(`${name}: no "Keyword Pool - ${safeTab(name)}.csv"`);

    const tqFile = files.find((f) => f.toLowerCase() === `topic queue - ${safeTab(name)}.csv`.toLowerCase());
    if (tqFile) await importTopics(clientId, read(tqFile));
    else report.problems.push(`${name}: no "Topic Queue - ${safeTab(name)}.csv"`);
  }

  console.log(JSON.stringify({ mode: COMMIT ? "commit" : "dry run", ...report }, null, 2));
}

async function uniqueSlug(name: string) {
  const base = slugify(name) || "client";
  let slug = base;
  for (let i = 2; await db.client.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  return slug;
}

async function importKeywords(clientId: string, rows: Row[]) {
  const data = rows
    .filter((r) => pick(r, "keyword"))
    .map((r) => {
      const status = pick(r, "status").toLowerCase();
      return {
        clientId,
        keyword: pick(r, "keyword"),
        keywordNorm: normalizeKeyword(pick(r, "keyword")),
        category: pick(r, "category") || null,
        searchVolume: Number(pick(r, "search_volume")) || null,
        difficulty: Number(pick(r, "difficulty")) || null,
        volumeVerified: yes(pick(r, "volume_verified")),
        status: status === "rejected" ? ("REJECTED" as const) : status === "approved" ? ("APPROVED" as const) : ("PENDING" as const),
        used: yes(pick(r, "used")),
        usedAt: date(pick(r, "date_used")),
        addedAt: date(pick(r, "date_added")) ?? new Date(),
        source: "IMPORT" as const,
      };
    });
  report.keywords += data.length;
  if (COMMIT && data.length) await db.keyword.createMany({ data, skipDuplicates: true });
}

async function importTopics(clientId: string, rows: Row[]) {
  for (const r of rows) {
    const keyword = pick(r, "keyword");
    const title = pick(r, "topic");
    if (!keyword || !title) continue;
    report.topics++;
    const topicStatus = pick(r, "topic_status").toLowerCase();
    const drafted = pick(r, "blog_status").toLowerCase() === "drafted";
    const wpUrl = pick(r, "wordpress_post_url");
    if (drafted) report.articles++;
    if (!COMMIT) continue;

    const exists = await db.topic.findFirst({ where: { clientId, keyword, title } });
    if (exists) continue;
    const kw = await db.keyword.findUnique({ where: { clientId_keywordNorm: { clientId, keywordNorm: normalizeKeyword(keyword) } } });
    const topic = await db.topic.create({
      data: {
        clientId,
        keywordId: kw?.id,
        keyword,
        title,
        category: pick(r, "category") || null,
        angle: pick(r, "angle") || null,
        secondaryKeywords: splitList(pick(r, "secondary_keywords")),
        status: topicStatus === "approved" || drafted ? "APPROVED" : topicStatus === "rejected" ? "REJECTED" : "GENERATED",
        generatedAt: date(pick(r, "date_generated")) ?? new Date(),
      },
    });
    if (drafted) {
      // Already in WordPress: keep a record so it isn't written again. Body lives in WordPress.
      await db.article.create({
        data: {
          clientId,
          topicId: topic.id,
          metaTitle: title,
          slug: slugify(title),
          focusKeyword: keyword,
          bodyHtml: `<p>Imported from Google Sheets. The full draft is in WordPress${wpUrl ? `: <a href="${wpUrl}">${wpUrl}</a>` : ""}.</p>`,
          status: "PUSHED_DRAFT",
          wpPostUrl: wpUrl || null,
        },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
