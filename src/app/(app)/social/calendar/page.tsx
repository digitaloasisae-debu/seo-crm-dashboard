import { superAdminOnly } from "../guard";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { monthKey, monthLabel, nextMonthKey, toLocalInput } from "@/lib/social/schedule";

const DOT: Record<string, string> = { DRAFT: "ring-amber-300", APPROVED: "ring-emerald-400", PUBLISHED: "ring-sky-400", PUBLISHING: "ring-sky-300", FAILED: "ring-red-500", REJECTED: "ring-red-200 opacity-40" };

export default async function SocialCalendar({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await superAdminOnly();
  const sp = await searchParams;
  const tz = "Asia/Dubai";
  const thisMonth = monthKey(new Date(), tz);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : thisMonth;
  const [y, m] = month.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const posts = await db.socialPost.findMany({
    where: { month, status: { not: "REJECTED" } },
    select: { id: true, status: true, headlineMain: true, scheduledAt: true, imageVersion: true, project: { select: { timezone: true, client: { select: { name: true } } } } },
    orderBy: { scheduledAt: "asc" },
  });
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const byDay = new Map<number, typeof posts>();
  for (const p of posts) {
    const local = toLocalInput(p.scheduledAt, p.project.timezone);
    if (!local.startsWith(month)) continue;
    const d = Number(local.slice(8, 10));
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }
  return (
    <>
      <PageHeader
        title={`Calendar · ${monthLabel(month)}`}
        subtitle="Amber = waiting for you, green = approved, blue = live, red = failed. Change a date on the post card."
        actions={<><Link className="btn-secondary" href={`/social/calendar?month=${prev}`}>←</Link><Link className="btn-secondary" href={`/social/calendar?month=${nextMonthKey(month)}`}>→</Link></>}
      />
      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-1 font-semibold text-slate-500">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`x${i}`} />)}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <div key={d} className="min-h-28 rounded-xl border border-slate-200 bg-white p-1.5">
            <div className="mb-1 text-slate-400">{d}</div>
            <div className="flex flex-wrap gap-1">
              {(byDay.get(d) ?? []).map((p) => (
                <Link key={p.id} href={`/social?month=${month}&show=all`} title={`${p.project.client.name}: ${p.headlineMain} (${p.status.toLowerCase()})`} className={`block h-14 w-11 overflow-hidden rounded-md bg-slate-100 ring-2 ${DOT[p.status] ?? ""}`}>
                  {p.imageVersion > 0 && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/social/image/${p.id}.jpg?v=${p.imageVersion}&w=120`} alt="" className="h-full w-full object-cover" />
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
