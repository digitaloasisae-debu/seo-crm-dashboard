import type { Client, SocialPost, SocialProject } from "@prisma/client";
import { angleOf } from "@/lib/social/ai";
import { designOf, fallbackText, formatOf } from "@/lib/social/formats";
import { fmtLocal, toLocalInput } from "@/lib/social/schedule";
import type { CardPost } from "./post-card";

/** Fields the review page needs (never the image bytes). */
export const POST_SELECT = {
  id: true, projectId: true, month: true, service: true, angle: true, idea: true, why: true, score: true, stage: true, stageError: true, status: true, rejectionReason: true,
  hooks: true, captionFacebook: true, captionInstagram: true, captionLinkedin: true, firstComment: true, headlineTop: true, headlineMain: true, headlineBottom: true,
  imageLayout: true, design: true, mediaId: true, imageVersion: true, scheduledAt: true, results: true, publishedAt: true, updatedAt: true,
} as const;

type Row = Pick<SocialPost, keyof typeof POST_SELECT> & { hasImage: boolean; hasPhoto: boolean };

export function toCard(p: Row, project: SocialProject & { client: Pick<Client, "name"> }): CardPost {
  const format = formatOf(p.imageLayout);
  return {
    id: p.id,
    project: project.client.name,
    platforms: project.platforms,
    service: p.service,
    angle: angleOf(p.angle).label,
    idea: p.idea,
    why: p.why,
    score: p.score,
    stage: p.stage,
    stageError: p.stageError,
    status: p.status,
    rejectionReason: p.rejectionReason,
    hooks: p.hooks,
    captionFacebook: p.captionFacebook,
    captionInstagram: p.captionInstagram,
    captionLinkedin: p.captionLinkedin,
    firstComment: p.firstComment,
    headlineTop: p.headlineTop,
    headlineMain: p.headlineMain,
    headlineBottom: p.headlineBottom,
    format,
    designText: format === "photo" ? "" : designOf(p.design).texts?.[format] ?? fallbackText(format, p),
    hasMedia: Boolean(p.mediaId),
    hasImage: p.hasImage,
    hasPhoto: p.hasPhoto,
    imageVersion: p.imageVersion,
    when: toLocalInput(p.scheduledAt, project.timezone),
    whenLabel: fmtLocal(p.scheduledAt, project.timezone),
    results: (p.results as CardPost["results"]) ?? null,
  };
}
