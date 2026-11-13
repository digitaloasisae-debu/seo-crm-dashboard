import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accessLevel } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { ScoreRing } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { Issue, PsiSummary, Shot } from "@/lib/audit";
import { Findings, findingsFromIssues, Screenshots, SpeedScores } from "@/components/audit-report";
import { PrintButton } from "@/components/print-button";

/** Client-facing audit report: screenshots, problems, what they mean and how we help. Print or save as PDF. */
export default async function ClientSeoReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!(await accessLevel(user, id))) notFound();
  const [client, audit] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id }, select: { name: true, siteUrl: true } }),
    db.siteAudit.findFirst({ where: { clientId: id, status: "DONE" }, orderBy: { startedAt: "desc" } }),
  ]);
  if (!audit) return <div className="card text-sm">No finished audit yet. <Link className="text-indigo-600 hover:underline" href={`/clients/${id}/seo`}>Run one on the SEO audit page.</Link></div>;
  const issues = (audit.issues as unknown as Issue[] | null) ?? [];
  const findings = findingsFromIssues(issues, audit.pagesChecked);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link className="text-sm text-indigo-600 hover:underline" href={`/clients/${id}/seo`}>← SEO audit</Link>
        <PrintButton />
      </div>
      <header className="card flex flex-wrap items-center gap-6">
        <ScoreRing score={audit.score} size={110} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Website audit</div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">{client.name}</h1>
          <p className="text-sm text-slate-600">{client.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} · {audit.pagesChecked} pages checked · {fmtDate(audit.finishedAt)}</p>
          <p className="text-sm text-slate-600">{findings.filter((f) => f.severity === "error").length} urgent, {findings.filter((f) => f.severity === "warning").length} important and {findings.filter((f) => f.severity === "notice").length} smaller problems found.</p>
        </div>
      </header>
      <Screenshots shots={(audit.shots as unknown as Shot[] | null) ?? []} />
      <SpeedScores mobile={audit.psiMobile as unknown as PsiSummary | null} desktop={audit.psiDesktop as unknown as PsiSummary | null} />
      <Findings findings={findings} />
    </div>
  );
}
