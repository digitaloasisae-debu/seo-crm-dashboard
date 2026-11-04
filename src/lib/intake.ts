import type { FormKind, FormSubmission, Prisma } from "@prisma/client";
import { db } from "./db";
import { encryptSecret } from "./crypto";
import { logActivity } from "./activity";
import { ensureSlots } from "./posting";
import { after } from "next/server";
import { triggerN8n } from "./n8n";
import { checkKeywords, dataforseoConfigured } from "./dataforseo";
import { fieldReader, redactPayload, submissionId, type TallyPayload } from "./tally";
import { normalizeKeyword, slugify, splitList, stripTrailingSlash, yes } from "./utils";

const WP_PASSWORD_LABELS = ["WordPress Application Password"];

/** Store the raw submission (password encrypted separately), then process it. Idempotent per Tally submission id. */
export async function receiveSubmission(form: FormKind, payload: TallyPayload) {
  const tallyId = submissionId(payload);
  const existing = await db.formSubmission.findUnique({ where: { tallySubmissionId: tallyId } });
  if (existing?.processedAt) return { submission: existing, duplicate: true };

  let sealed: ReturnType<typeof encryptSecret> | null = null;
  if (form === "ONBOARDING") {
    const pw = fieldReader(payload)(...WP_PASSWORD_LABELS);
    if (pw) sealed = encryptSecret(pw);
  }

  const submission =
    existing ??
    (await db.formSubmission.create({
      data: {
        form,
        tallySubmissionId: tallyId,
        payload: redactPayload(payload, WP_PASSWORD_LABELS) as unknown as Prisma.InputJsonValue,
        secretEncrypted: sealed?.secretEncrypted,
        secretIv: sealed?.iv,
        secretKeyVersion: sealed?.keyVersion,
      },
    }));

  return { submission: await processSubmission(submission, payload), duplicate: false };
}

/** Process (or re-process, from the Intake screen) a stored submission. */
export async function processSubmission(submission: FormSubmission, payload?: TallyPayload) {
  const body = payload ?? (submission.payload as unknown as TallyPayload);
  try {
    const clientId =
      submission.form === "ONBOARDING" ? await processOnboarding(body, submission) : await processKeywords(body);
    return db.formSubmission.update({
      where: { id: submission.id },
      data: { processedAt: new Date(), error: null, clientId },
    });
  } catch (e) {
    return db.formSubmission.update({
      where: { id: submission.id },
      data: { error: e instanceof Error ? e.message : String(e) },
    });
  }
}

async function processOnboarding(payload: TallyPayload, submission: FormSubmission): Promise<string> {
  const get = fieldReader(payload);
  const name = get("Client / Business Name", "Client/Business Name", "Business Name");
  const siteUrl = stripTrailingSlash(get("Website URL"));
  if (!name) throw new Error("Client / Business Name is empty");
  if (!siteUrl) throw new Error("Website URL is empty");

  const posts = Number(get("Posts per month"));
  const data = {
    name,
    siteUrl,
    servicesOffered: splitList(get("Services Offered")),
    targetAudience: get("Target Audience") || null,
    competitors: splitList(get("Competitors")),
    businessType: get("Business Type") || null,
    targetCountry: get("Target Country") || null,
    primaryCity: get("Primary City") || null,
    serviceAreaCities: splitList(get("Surrounding Service-Area Cities", "Service Area Cities")),
    brandVoiceAvoid: get("Words/topics/claims to avoid") || null,
    ctaText: get("Primary CTA text") || null,
    ctaLink: get("Primary CTA Link") || null,
    postsPerMonth: Number.isFinite(posts) ? posts : 0,
    preferredDates: splitList(get("Preferred posting dates")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    imageRequired: yes(get("Is image generation required?")),
    imageStyle: get("Preferred image style") || null,
    referenceImages: splitList(get("Reference Images")),
    cmsPlatform: get("CMS Platform") || null,
    cmsPreviewSupported: yes(get("Does the CMS support draft/preview", "CMS draft/preview")),
    linkPool: splitList(get("Link Pool", "Sitemap or key page URLs")),
    socialLinks: splitList(get("Social / External Profile Links", "Social/External Profile Links")),
    masterTemplateUrl: get("Master Template Post") || null,
    gscAccount: get("Which GSC account", "GSC Account") || null,
    submittedBy: get("Submitted by") || null,
  };

  const endpoint = stripTrailingSlash(get("WordPress Draft API Endpoint"));
  const username = get("WordPress Username");

  const client = await db.$transaction(async (tx) => {
    const existing = await tx.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    const client = existing
      ? await tx.client.update({ where: { id: existing.id }, data })
      : await tx.client.create({ data: { ...data, slug: await uniqueSlug(tx, name) } });

    if (endpoint && username && submission.secretEncrypted && submission.secretIv && submission.secretKeyVersion) {
      const cred = {
        endpoint,
        username,
        secretEncrypted: submission.secretEncrypted,
        iv: submission.secretIv,
        keyVersion: submission.secretKeyVersion,
        lastVerifiedAt: null,
        lastError: null,
      };
      await tx.clientCredential.upsert({
        where: { clientId_kind: { clientId: client.id, kind: "WORDPRESS" } },
        create: { clientId: client.id, kind: "WORDPRESS", ...cred },
        update: cred,
      });
    }

    // If the submitter is a team member (matched by email or name), make them the owner.
    if (data.submittedBy) {
      const member = await tx.user.findFirst({
        where: {
          active: true,
          OR: [
            { email: { equals: data.submittedBy, mode: "insensitive" } },
            { name: { equals: data.submittedBy, mode: "insensitive" } },
          ],
        },
      });
      if (member && member.role !== "SUPER_ADMIN") {
        await tx.clientAssignment.upsert({
          where: { clientId_userId: { clientId: client.id, userId: member.id } },
          create: { clientId: client.id, userId: member.id, access: "OWNER" },
          update: {},
        });
      }
    }

    await logActivity(
      { actorTag: "tally", clientId: client.id, action: existing ? "client.update_from_tally" : "client.create", entity: "client", entityId: client.id },
      tx,
    );
    return client;
  });

  await ensureSlots(client.id);
  return client.id;
}

async function uniqueSlug(tx: Prisma.TransactionClient, name: string) {
  const base = slugify(name) || "client";
  let slug = base;
  for (let i = 2; await tx.client.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  return slug;
}

async function processKeywords(payload: TallyPayload): Promise<string> {
  const get = fieldReader(payload);
  // Prefer the hidden `client_slug` field (prefilled from the dashboard link), then the typed name.
  const slug = get.exact("client_slug");
  const name = get("Client Name");
  const client =
    (slug && (await db.client.findUnique({ where: { slug } }))) ||
    (name && (await db.client.findFirst({ where: { name: { equals: name.trim(), mode: "insensitive" } } }))) ||
    (name && (await db.client.findUnique({ where: { slug: slugify(name) } })));
  if (!client) throw new Error(`No client matches "${slug || name}". Fix the name on the Intake screen and retry, or add the client first.`);

  const submittedBy = get("Submitted By", "Submitted by") || null;
  await addKeywords(client.id, splitList(get("Keywords")), { source: "TALLY", submittedBy, actorTag: "tally" });

  // After the webhook has answered: check volume/difficulty, then start topic generation (WF1) as before the dashboard,
  // so WF1 already sees the numbers.
  background(async () => {
    if (process.env.N8N_WF1_WEBHOOK_URL) {
      try {
        await triggerN8n("WF1", { client_id: client.id, requested_by: submittedBy ?? "tally" });
        await logActivity({ actorTag: "tally", clientId: client.id, action: "n8n.trigger_wf1", entity: "client", entityId: client.id });
      } catch (e) {
        // Keywords are saved either way; the team can start WF1 from the client page.
        await logActivity({ actorTag: "tally", clientId: client.id, action: "n8n.trigger_wf1_failed", entity: "client", entityId: client.id, after: { error: e instanceof Error ? e.message : String(e) } });
      }
    }
  }, { checkClientId: client.id });
  return client.id;
}

/** Insert keywords, skipping duplicates already in the pool. Shared by Tally, the UI and the n8n API. */
export async function addKeywords(
  clientId: string,
  keywords: string[],
  opts: { source: "TALLY" | "MANUAL" | "API" | "IMPORT"; submittedBy?: string | null; actorId?: string; actorTag?: string; category?: string },
) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  const seen = new Set<string>();
  const rows = keywords
    .map((k) => k.trim().replace(/\s+/g, " "))
    .filter((k) => {
      const n = normalizeKeyword(k);
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    })
    .map((keyword) => ({
      clientId,
      keyword,
      keywordNorm: normalizeKeyword(keyword),
      category: opts.category,
      source: opts.source,
      submittedBy: opts.submittedBy ?? null,
      // Team members submit keywords themselves, so Tally keywords are approved on arrival (per-client setting).
      status: client.autoApproveKeywords ? ("APPROVED" as const) : ("PENDING" as const),
    }));
  if (!rows.length) throw new Error("No keywords in the submission");

  const res = await db.keyword.createMany({ data: rows, skipDuplicates: true });
  await logActivity({
    actorId: opts.actorId,
    actorTag: opts.actorTag,
    clientId,
    action: "keyword.add",
    entity: "client",
    entityId: clientId,
    after: { submitted: rows.length, added: res.count },
  });
  // Tally submissions check keywords together with starting WF1 (see processKeywords).
  if (opts.source !== "TALLY" && res.count) background(async () => {}, { checkClientId: clientId });
  return clientId;
}

/** Runs work after the response is sent: first the keyword check (if DataForSEO is set up), then fn. */
function background(fn: () => Promise<void>, opts: { checkClientId?: string } = {}) {
  const job = async () => {
    if (opts.checkClientId && dataforseoConfigured()) {
      await checkKeywords(opts.checkClientId).catch((e) => console.error("keywords.check_failed", opts.checkClientId, e));
    }
    await fn();
  };
  try {
    after(job);
  } catch {
    void job(); // outside a request (scripts)
  }
}
