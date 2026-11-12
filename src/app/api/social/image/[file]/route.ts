import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";

/**
 * Public JPEG of a social post ("<id>.jpg", carousel slides "<id>-2.jpg"...). Facebook, Instagram and LinkedIn fetch it from here
 * when n8n publishes, so it can't sit behind the login. Post ids are long random ids.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // "<id>.jpg" = the image (or a carousel's cover), "<id>-2.jpg" = carousel slide 2, and so on.
  const m = file.match(/^([a-z0-9]{20,40})(?:-(\d{1,2}))?\.jpe?g$/i);
  if (!m) return new NextResponse("Not found", { status: 404 });
  const [, id, n] = m;
  const post = n
    ? await db.socialPost.findUnique({ where: { id }, select: { slides: true } }).then((p) => ({ image: p?.slides[Number(n) - 2] ?? null }))
    : await db.socialPost.findUnique({ where: { id }, select: { image: true } });
  if (!post?.image) return new NextResponse("Not found", { status: 404 });
  let body = Buffer.from(post.image);
  const w = Number(req.nextUrl.searchParams.get("w"));
  if (w >= 40 && w <= 1080) body = await sharp(body).resize({ width: Math.round(w) }).jpeg({ quality: 80 }).toBuffer();
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(body.length), "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
