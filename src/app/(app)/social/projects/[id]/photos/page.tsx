import { notFound } from "next/navigation";
import { superAdminOnly } from "../../../guard";
import { db } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { deleteMediaAction, saveMediaAction } from "../../../actions";
import { ProjectTabs } from "../tabs";
import { PhotoUploader } from "./uploader";

export default async function SocialPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  await superAdminOnly();
  const { id } = await params;
  const p = await db.socialProject.findUnique({ where: { id }, include: { client: { select: { name: true } } } });
  if (!p) notFound();
  const media = await db.socialMedia.findMany({ where: { projectId: id }, select: { id: true, description: true, usedCount: true, width: true, height: true }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title={p.client.name} subtitle="Real photos for photo posts. The AI reads each one and picks the right photo for a post, so posts don't need made-up AI images." />
      <ProjectTabs id={id} active="photos" />
      <div className="space-y-5">
        <PhotoUploader projectId={id} />
        {media.length === 0 ? (
          <Empty>No photos yet. Until you add some, posts use the text designs (big type, note, list, versus) instead of photos.</Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {media.map((m) => (
              <div key={m.id} className="card space-y-2 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/social/media/${m.id}.jpg?w=600`} alt={m.description} className="aspect-[4/5] w-full rounded-md bg-slate-100 object-cover" />
                <form action={saveMediaAction.bind(null, m.id)} className="space-y-2">
                  <textarea name="description" defaultValue={m.description} rows={3} className="input text-xs leading-5" placeholder="Being described by the AI… you can also write what it shows." />
                  <div className="flex items-center gap-2">
                    <SubmitButton className="btn-secondary text-xs">Save</SubmitButton>
                    <span className="flex-1 text-xs text-slate-400">{m.usedCount ? `used in ${m.usedCount} post${m.usedCount > 1 ? "s" : ""}` : "not used yet"}</span>
                    <SubmitButton formAction={deleteMediaAction.bind(null, m.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</SubmitButton>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
