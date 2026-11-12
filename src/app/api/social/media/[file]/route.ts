import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

/** A photo from a social project's library (Super Admin only). ?w= gives a thumbnail. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const user = await currentUser();
  if (user?.role !== "SUPER_ADMIN") return new NextResponse("Not found", { status: 404 });
  const id = (await params).file.replace(/\.jpe?g$/i, "");
  if (!/^[a-z0-9]{20,40}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const m = await db.socialMedia.findUnique({ where: { id }, select: { data: true } });
  if (!m) return new NextResponse("Not found", { status: 404 });
  let body = Buffer.from(m.data);
  const w = Number(req.nextUrl.searchParams.get("w"));
  if (w >= 40 && w <= 1600) body = await sharp(body).resize({ width: Math.round(w) }).jpeg({ quality: 80 }).toBuffer();
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
