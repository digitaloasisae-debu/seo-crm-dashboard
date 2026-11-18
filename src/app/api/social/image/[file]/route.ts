import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { cached } from "@/lib/file-cache";

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
  const w = Number(req.nextUrl.searchParams.get("w"));
  const width = w >= 40 && w <= 1080 ? Math.round(w) : 0;
  const v = (req.nextUrl.searchParams.get("v") ?? "").replace(/[^0-9]/g, "");
  const load = async () => {
    const post = n
      ? await db.socialPost.findUnique({ where: { id }, select: { slides: true } }).then((p) => ({ image: p?.slides[Number(n) - 2] ?? null }))
      : await db.socialPost.findUnique({ where: { id }, select: { image: true } });
    if (!post?.image) return null;
    const raw = Buffer.from(post.image);
    return width ? sharp(raw).resize({ width }).jpeg({ quality: 80 }).toBuffer() : raw;
  };
  // Only versioned URLs are cached: without ?v= the image may change under the same name.
  const body = v ? await cached(`post-${file}-v${v}-w${width}`, load) : await load();
  if (!body) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(body.length), "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
