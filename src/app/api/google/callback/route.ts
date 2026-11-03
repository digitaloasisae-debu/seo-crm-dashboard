import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { listSites, matchSite, saveConnection } from "@/lib/google";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "SUPER_ADMIN") return NextResponse.redirect(new URL("/login", req.url));
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/google?${q}`, req.url));
    res.cookies.delete({ name: "g_state", path: "/api/google" });
    return res;
  };
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return back(`error=${encodeURIComponent(p.get("error")!)}`);
  if (!p.get("state") || p.get("state") !== req.cookies.get("g_state")?.value) return back("error=state_mismatch");
  try {
    const conn = await saveConnection(p.get("code") ?? "", user.id);
    // Link every client that has no property yet to its matching Search Console property.
    const { sites } = await listSites();
    const clients = await db.client.findMany({ where: { gscProperty: null }, select: { id: true, siteUrl: true } });
    let linked = 0;
    for (const c of clients) {
      const m = matchSite(c.siteUrl, sites);
      if (m) {
        await db.client.update({ where: { id: c.id }, data: { gscProperty: m.siteUrl, gscConnectionId: m.connectionId } });
        linked++;
      }
    }
    return back(`connected=${encodeURIComponent(conn.email)}&linked=${linked}`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
