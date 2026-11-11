import Link from "next/link";
import { DataTable, type Row } from "@/components/data-table";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Empty, PageHeader, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { LostQuery } from "@/lib/refresh";

export const metadata = { title: "Losing traffic" };

const STATE: Record<string, string> = { OPEN: "Needs a plan", DRAFTED: "Plan ready", DONE: "Updated" };

/** Every page losing Google clicks, across all the clients this person can see. */
export default async function LosingTraffic() {
  const user = await requireUser();
  const rows = await db.contentRefresh.findMany({
    where: { client: clientScope(user), status: { not: "DISMISSED" } },
    include: { client: { select: { id: true, name: true } } },
    orderBy: [{ status: "asc" }, { clicksBefore: "desc" }],
  });
  const open = rows.filter((r) => r.status !== "DONE");
  const clients = new Set(open.map((r) => r.clientId)).size;
  const lostClicks = open.reduce((a, r) => a + Math.max(0, r.clicksBefore - r.clicksNow), 0);
  const recovered = rows.filter((r) => r.status === "DONE" && r.afterClicks != null && r.baseClicks != null && r.afterClicks > r.baseClicks).length;

  return (
    <>
      <PageHeader title="Losing traffic" subtitle="Pages whose Google clicks fell 30% or more, for every client. Click a row to plan the update on that client's Refresh tab." />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Pages losing traffic" value={open.length} icon="trending" alert />
        <Stat label="Clients affected" value={clients} icon="briefcase" />
        <Stat label="Clicks lost per 4 weeks" value={lostClicks} icon="chart" />
        <Stat label="Recovered after update" value={recovered} icon="check" />
      </div>
      {rows.length === 0 ? (
        <Empty icon="trending">No pages are losing traffic right now. Clients need Search Console linked for this to work.</Empty>
      ) : (
        <DataTable
          id="losing-traffic"
          columns={[
            { key: "client", label: "Client", type: "enum" },
            { key: "page", label: "Page" },
            { key: "drop", label: "Drop", type: "number", align: "right", title: "Clicks lost, last 4 weeks vs. the page's best 4 weeks" },
            { key: "clicks", label: "Clicks", type: "number", align: "right" },
            { key: "position", label: "Position", type: "number", align: "right" },
            { key: "lost", label: "Top lost search" },
            { key: "state", label: "Next step", type: "enum" },
            { key: "found", label: "Found", type: "date" },
          ]}
          defaultSort={{ key: "drop", dir: "desc" }}
          presets={[
            { label: "Needs a plan", filters: { state: ["Needs a plan"] } },
            { label: "Plan ready", filters: { state: ["Plan ready"] } },
            { label: "Updated", filters: { state: ["Updated"] } },
          ]}
          searchPlaceholder="Search pages or clients"
          rows={rows.map((r): Row => {
            const drop = Math.round((1 - r.clicksNow / Math.max(1, r.clicksBefore)) * 100);
            const top = ((r.lostQueries as unknown as LostQuery[] | null) ?? [])[0];
            const state = STATE[r.status] ?? r.status;
            const path = r.page.replace(/^https?:\/\/[^/]+/, "") || "/";
            return {
              id: r.id,
              href: `/clients/${r.clientId}/refresh#r-${r.id}`,
              values: { client: r.client.name, page: path, drop, clicks: r.clicksNow, position: r.posNow != null ? Number(r.posNow.toFixed(1)) : null, lost: top?.query ?? "", state, found: r.createdAt.toISOString() },
              cells: {
                client: <Link href={`/clients/${r.clientId}/refresh`} className="font-medium text-slate-900 hover:underline">{r.client.name}</Link>,
                page: <a href={r.page} target="_blank" rel="noreferrer" className="block max-w-72 truncate text-indigo-600 hover:underline" title={r.page}>{path}</a>,
                drop: <span className="num font-medium text-red-600">−{drop}%</span>,
                clicks: <span className="num whitespace-nowrap">{r.clicksBefore} → {r.clicksNow}</span>,
                position: <span className="num whitespace-nowrap text-slate-600">{r.posBefore?.toFixed(1) ?? "–"} → {r.posNow?.toFixed(1) ?? "–"}</span>,
                lost: top ? <span className="text-xs"><span className="text-slate-800">{top.query}</span> <span className="num text-slate-500">{top.before} → {top.now}</span></span> : <span className="text-slate-300">—</span>,
                state: <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${r.status === "DONE" ? "bg-emerald-50 text-emerald-700" : r.status === "DRAFTED" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700"}`}>{state}</span>,
                found: <span className="whitespace-nowrap text-slate-500">{fmtDate(r.createdAt)}</span>,
              },
            };
          })}
        />
      )}
    </>
  );
}
