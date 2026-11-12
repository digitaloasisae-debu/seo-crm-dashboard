/**
 * Animated Reels: the post's visual with a slow push-in, and the post's lines of text appearing
 * one after another (fade + small rise), then the brand card. Silent (a quiet audio track is added
 * because some apps reject videos without one). 1080x1920 H.264 MP4, about 10 seconds.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const FPS = 30;
const LINE = 3.1; // seconds per line of text
const LEAD = 0.35; // before the first line
const TAIL = 1.6; // after the last line appears it stays, with the brand card

function run(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("Video tool (ffmpeg) is missing"));
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-3000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Video render failed: ${err.split("\n").filter(Boolean).slice(-3).join(" ")}`))));
  });
}

export async function renderReel(layers: { base: Buffer; lines: Buffer[]; brand: Buffer }): Promise<Buffer> {
  const n = Math.max(1, layers.lines.length);
  const total = LEAD + LINE * (n - 1) + LINE + TAIL;
  const dir = await mkdtemp(path.join(tmpdir(), "reel-"));
  try {
    await writeFile(path.join(dir, "base.jpg"), layers.base);
    await Promise.all(layers.lines.map((b, i) => writeFile(path.join(dir, `l${i}.png`), b)));
    await writeFile(path.join(dir, "brand.png"), layers.brand);
    const frames = Math.round(total * FPS);
    const args = ["-y", "-loglevel", "error", "-loop", "1", "-framerate", String(FPS), "-t", total.toFixed(2), "-i", path.join(dir, "base.jpg")];
    layers.lines.forEach((_, i) => args.push("-loop", "1", "-framerate", String(FPS), "-t", total.toFixed(2), "-i", path.join(dir, `l${i}.png`)));
    args.push("-loop", "1", "-framerate", String(FPS), "-t", total.toFixed(2), "-i", path.join(dir, "brand.png"));
    args.push("-f", "lavfi", "-t", total.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo");
    // Slow push-in on the background (upscaled first so the zoom is smooth).
    const f: string[] = [`[0:v]scale=1620:2880,zoompan=z='1+0.07*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${FPS},format=yuv420p[bg]`];
    let last = "bg";
    layers.lines.forEach((_, i) => {
      const start = LEAD + i * LINE;
      const isLast = i === n - 1;
      const fades = `fade=in:st=${start.toFixed(2)}:d=0.4:alpha=1${isLast ? "" : `,fade=out:st=${(start + LINE - 0.35).toFixed(2)}:d=0.3:alpha=1`}`;
      f.push(`[${i + 1}:v]format=rgba,${fades}[t${i}]`);
      // Each line rises 40px into place while it fades in.
      f.push(`[${last}][t${i}]overlay=x=0:y='if(lt(t,${start.toFixed(2)}),40,if(lt(t,${(start + 0.45).toFixed(2)}),40*(1-(t-${start.toFixed(2)})/0.45),0))':format=auto[v${i}]`);
      last = `v${i}`;
    });
    const brandAt = LEAD + LINE * (n - 1) + 0.6;
    f.push(`[${n + 1}:v]format=rgba,fade=in:st=${brandAt.toFixed(2)}:d=0.4:alpha=1[br]`);
    f.push(`[${last}][br]overlay=0:0:format=auto,format=yuv420p[out]`);
    args.push("-filter_complex", f.join(";"), "-map", "[out]", "-map", `${n + 2}:a`);
    args.push("-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-crf", "21", "-maxrate", "6M", "-bufsize", "12M", "-r", String(FPS), "-pix_fmt", "yuv420p");
    args.push("-c:a", "aac", "-b:a", "64k", "-shortest", "-movflags", "+faststart", path.join(dir, "out.mp4"));
    await run(args);
    return await readFile(path.join(dir, "out.mp4"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
