import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";

/**
 * Public JPEG of a social post ("<id>.jpg"). Facebook, Instagram and LinkedIn fetch it from here
 * when n8n publishes, so it can't sit behind the login. Post ids are long random ids.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = file.replace(/\.jpe?g$/i, "");
  if (!/^[a-z0-9]{20,40}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const post = await db.socialPost.findUnique({ where: { id }, select: { image: true } });
  if (!post?.image) return new NextResponse("Not found", { status: 404 });
  let body = Buffer.from(post.image);
  const w = Number(req.nextUrl.searchParams.get("w"));
  if (w >= 40 && w <= 1080) body = await sharp(body).resize({ width: Math.round(w) }).jpeg({ quality: 80 }).toBuffer();
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(body.length), "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
