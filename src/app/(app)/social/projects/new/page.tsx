import { superAdminOnly } from "../../guard";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createProjectAction } from "../../actions";
import { ProjectFields } from "../fields";

export default async function NewSocialProject({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await superAdminOnly();
  const { err } = await searchParams;
  const clients = await db.client.findMany({ where: { socialProject: null, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Add a social project" subtitle="Pick the client whose social accounts this is. Its brand profile, colours and logo are used for every post." />
      {err && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      <form action={createProjectAction} className="card space-y-4">
        <label className="block max-w-md">
          <span className="label">Client</span>
          <select name="clientId" className="input" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <ProjectFields />
        <SubmitButton className="btn-primary">Add project</SubmitButton>
        <p className="text-xs text-slate-500">After saving, the AI reads the website and writes a fact card for each service (about a minute).</p>
      </form>
    </>
  );
}
