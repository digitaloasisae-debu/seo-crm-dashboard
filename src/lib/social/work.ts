/**
 * The Social Studio worker: turns planned ideas into finished drafts (captions, then image).
 * Runs from the Social page while it is open, and from the n8n tick every 15 minutes.
 * Stages: idea -> writing -> written -> drawing -> ready (or error after 3 failed tries).
 */
import type { SocialPost } from "@prisma/client";
import { db } from "../db";
import { writePosts } from "./ai";
import { designImage, drawPhoto } from "./image";

const MAX_TRIES = 3;
const STALE_MS = 6 * 60_000;

/** Put posts back in the queue if a worker died halfway (timeout, deploy). */
async function releaseStale() {
  const before = new Date(Date.now() - STALE_MS);
  await db.socialPost.updateMany({ where: { stage: "writing", updatedAt: { lt: before } }, data: { stage: "idea" } });
  await db.socialPost.updateMany({ where: { stage: "drawing", updatedAt: { lt: before } }, data: { stage: "written" } });
}

/** Claim posts in `from` stage by moving them to `to`. Returns the ones this worker got. */
async function claim(ids: string[], from: string, to: string) {
  const got: string[] = [];
  for (const id of ids) {
    const r = await db.socialPost.updateMany({ where: { id, stage: from }, data: { stage: to } });
    if (r.count) got.push(id);
  }
  return got.length ? db.socialPost.findMany({ where: { id: { in: got } } }) : [];
}

async function fail(posts: SocialPost[], back: string, e: unknown) {
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  for (const p of posts) {
    await db.socialPost.update({ where: { id: p.id }, data: { attempts: { increment: 1 }, stageError: msg, stage: p.attempts + 1 >= MAX_TRIES ? "error" : back } });
  }
}

/** Captions for up to 4 posts of one project. */
async function writeStep(only?: string[]) {
  const next = await db.socialPost.findFirst({ where: { stage: "idea", ...(only ? { id: { in: only } } : {}) }, orderBy: { scheduledAt: "asc" }, select: { projectId: true } });
  if (!next) return 0;
  const ids = (await db.socialPost.findMany({ where: { stage: "idea", projectId: next.projectId, ...(only ? { id: { in: only } } : {}) }, orderBy: { scheduledAt: "asc" }, take: 4, select: { id: true } })).map((x) => x.id);
  const posts = await claim(ids, "idea", "writing");
  if (!posts.length) return 0;
  try {
    await writePosts(posts);
    await db.socialPost.updateMany({ where: { id: { in: posts.map((p) => p.id) }, stage: "writing" }, data: { stage: "written", stageError: null } });
  } catch (e) {
    await fail(posts, "idea", e);
  }
  return posts.length;
}

/** Photo (only when missing) + design for one post. */
export async function drawOne(postId: string) {
  const [post] = await claim([postId], "written", "drawing");
  if (!post) return false;
  try {
    const project = await db.socialProject.findUniqueOrThrow({ where: { id: post.projectId }, include: { client: true } });
    const photo = post.photo ? Buffer.from(post.photo) : await drawPhoto(post, project);
    const image = await designImage(post, project, photo);
    await db.socialPost.update({
      where: { id: post.id },
      data: { photo: new Uint8Array(photo), image: new Uint8Array(image), imageVersion: { increment: 1 }, stage: "ready", stageError: null, imageNote: null },
    });
  } catch (e) {
    await fail([post], "written", e);
  }
  return true;
}

async function drawStep(only?: string[], parallel = 2) {
  const ids = (await db.socialPost.findMany({ where: { stage: "written", ...(only ? { id: { in: only } } : {}) }, orderBy: { scheduledAt: "asc" }, take: parallel, select: { id: true } })).map((x) => x.id);
  const done = await Promise.all(ids.map((id) => drawOne(id)));
  return done.filter(Boolean).length;
}

/** Do as much work as fits in `budgetMs`. Returns what is left to do. */
export async function socialWork(budgetMs: number, only?: string[]) {
  const end = Date.now() + budgetMs;
  await releaseStale();
  let written = 0;
  let drawn = 0;
  while (Date.now() < end - 75_000) {
    const w = await writeStep(only);
    written += w;
    if (w) continue;
    const d = await drawStep(only);
    drawn += d;
    if (!d) break;
  }
  return { written, drawn, ...(await socialBacklog()) };
}

export async function socialBacklog() {
  const rows = await db.socialPost.groupBy({ by: ["stage"], where: { stage: { not: "ready" } }, _count: true });
  const n = (s: string) => rows.find((r) => r.stage === s)?._count ?? 0;
  return { toWrite: n("idea") + n("writing"), toDraw: n("written") + n("drawing"), failed: n("error") };
}

/** Run one post through every remaining step right now (used by the regenerate buttons). */
export async function finishPost(postId: string) {
  for (let i = 0; i < 3; i++) {
    const p = await db.socialPost.findUnique({ where: { id: postId }, select: { stage: true } });
    if (!p || p.stage === "ready" || p.stage === "error") return p?.stage;
    if (p.stage === "idea") await writeStep([postId]);
    else if (p.stage === "written") await drawOne(postId);
    else return p.stage; // another worker has it
  }
  return (await db.socialPost.findUnique({ where: { id: postId }, select: { stage: true } }))?.stage;
}
