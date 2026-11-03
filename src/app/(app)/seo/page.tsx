import Link from "next/link";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { Issue, PsiSummary } from "@/lib/audit";

function tone(n: number | null | undefined) {
  if (n == null) return "text-slate-400";
  return n >= 90 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-red-600";
}

export default async function SeoOverview() {
  const user = await requireUser();
  const clients = await db.client.findMany({
    where: { ...clientScope(user), status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, audits: { where: { status: "DONE" }, orderBy: { startedAt: "desc" }, take: 2 } },
  });
  return (
    <>
      <PageHeader title="SEO" subtitle="Latest site audit for each client. Open a client to run a new one." />
      {clients.length === 0 ? <Empty>No clients.</Empty> : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Client</th><th>Health</th><th>Change</th><th>Mobile perf.</th><th>Errors</th><th>Last audit</th></tr></thead>
            <tbody>
              {clients.map((c) => {
                const [a, prev] = c.audits;
                const errors = ((a?.issues as unknown as Issue[] | null) ?? []).filter((i) => i.severity === "error").length;
                const delta = a?.score != null && prev?.score != null ? a.score - prev.score : null;
                return (
                  <tr key={c.id}>
                    <td><Link className="text-indigo-600 hover:underline" href={`/clients/${c.id}/seo`}>{c.name}</Link></td>
                    <td className={`font-semibold ${tone(a?.score)}`}>{a?.score ?? "—"}</td>
                    <td className={delta == null ? "text-slate-400" : delta >= 0 ? "text-emerald-600" : "text-red-600"}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}</td>
                    <td className={tone((a?.psiMobile as unknown as PsiSummary | null)?.performance)}>{(a?.psiMobile as unknown as PsiSummary | null)?.performance ?? "—"}</td>
                    <td className={errors ? "text-red-600" : "text-slate-500"}>{a ? errors : "—"}</td>
                    <td className="text-slate-500">{a ? fmtDate(a.finishedAt) : "never"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
