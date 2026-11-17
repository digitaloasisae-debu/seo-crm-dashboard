/**
 * Animated Reels: the post's visual with a slow push-in, and the post's lines of text appearing
 * one after another (fade + small rise), then the brand card. Silent (a quiet audio track is added
 * because some apps reject videos without one). 1080x1920 H.264 MP4, 10-16 seconds (each line stays long enough to read).
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const FPS = 25;
const LINE = 3.1; // seconds per line of text when no reading time is given
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

export async function renderReel(layers: { base: Buffer; lines: Buffer[]; brand: Buffer; durations?: number[] }): Promise<Buffer> {
  const n = Math.max(1, layers.lines.length);
  const dur = (i: number) => layers.durations?.[i] ?? LINE;
  const startOf = (i: number) => LEAD + Array.from({ length: i }, (_, k) => dur(k)).reduce((a, b) => a + b, 0);
  const total = startOf(n - 1) + dur(n - 1) + TAIL;
  const dir = await mkdtemp(path.join(tmpdir(), "reel-"));
  try {
    await writeFile(path.join(dir, "base.jpg"), layers.base);
    await Promise.all(layers.lines.map((b, i) => writeFile(path.join(dir, `l${i}.png`), b)));
    await writeFile(path.join(dir, "brand.png"), layers.brand);
    const frames = Math.round(total * FPS);
    const args = ["-y", "-loglevel", "error", "-loop", "1", "-framerate", String(FPS), "-t", total.toFixed(2), "-i", path.join(dir, "base.jpg")];
    // Each text layer is only as long as its time on screen and is shifted to its start, so the
    // encoder doesn't blend 7 full-frame layers on every frame of the video.
    const brandAt = startOf(n - 1) + 0.6;
    layers.lines.forEach((_, i) => args.push("-loop", "1", "-framerate", String(FPS), "-t", (i === n - 1 ? total - startOf(i) : dur(i)).toFixed(2), "-i", path.join(dir, `l${i}.png`)));
    args.push("-loop", "1", "-framerate", String(FPS), "-t", (total - brandAt).toFixed(2), "-i", path.join(dir, "brand.png"));
    args.push("-f", "lavfi", "-t", total.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo");
    // Slow push-in on the background (upscaled first so the zoom is smooth).
    const f: string[] = [`[0:v]scale=1296:2304,zoompan=z='1+0.07*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${FPS},format=yuv420p[bg]`];
    let last = "bg";
    layers.lines.forEach((_, i) => {
      const start = startOf(i);
      const isLast = i === n - 1;
      const fades = `fade=in:st=0:d=0.4:alpha=1${isLast ? "" : `,fade=out:st=${(dur(i) - 0.35).toFixed(2)}:d=0.3:alpha=1`}`;
      f.push(`[${i + 1}:v]format=rgba,${fades},setpts=PTS+${start.toFixed(2)}/TB[t${i}]`);
      // Each line rises 40px into place while it fades in.
      f.push(`[${last}][t${i}]overlay=x=0:y='if(lt(t,${start.toFixed(2)}),40,if(lt(t,${(start + 0.45).toFixed(2)}),40*(1-(t-${start.toFixed(2)})/0.45),0))':format=auto:eof_action=pass[v${i}]`);
      last = `v${i}`;
    });
    f.push(`[${n + 1}:v]format=rgba,fade=in:st=0:d=0.4:alpha=1,setpts=PTS+${brandAt.toFixed(2)}/TB[br]`);
    f.push(`[${last}][br]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[out]`);
    args.push("-filter_complex", f.join(";"), "-map", "[out]", "-map", `${n + 2}:a`);
    args.push("-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-crf", "21", "-maxrate", "6M", "-bufsize", "12M", "-r", String(FPS), "-pix_fmt", "yuv420p");
    args.push("-c:a", "aac", "-b:a", "64k", "-shortest", "-movflags", "+faststart", path.join(dir, "out.mp4"));
    await run(args);
    return await readFile(path.join(dir, "out.mp4"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
