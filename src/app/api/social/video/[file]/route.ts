import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * Public MP4 of a Reel ("<id>.mp4"). Instagram and Facebook fetch it from here when n8n publishes,
 * so it can't sit behind the login. Supports Range requests (browsers' video players need them).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = file.replace(/\.mp4$/i, "");
  if (!/^[a-z0-9]{20,40}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const post = await db.socialPost.findUnique({ where: { id }, select: { video: true } });
  if (!post?.video) return new NextResponse("Not found", { status: 404 });
  const body = Buffer.from(post.video);
  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable" };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : body.length - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : body.length - 1;
    start = Math.max(0, start);
    end = Math.min(end, body.length - 1);
    if (start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${body.length}` } });
    const part = body.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(part), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": String(part.length) } });
  }
  return new NextResponse(new Uint8Array(body), { headers: { ...headers, "Content-Length": String(body.length) } });
}
