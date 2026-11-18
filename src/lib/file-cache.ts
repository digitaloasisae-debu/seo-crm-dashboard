import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// On the VPS there is no CDN in front of the app, so every image would be read from the database
// (and resized) on each view. This keeps finished image bytes on the server's disk instead.
// Keys must change whenever the image changes (they include the post's image version).
const DIR = path.join(os.tmpdir(), "rankflow-cache");

const safe = (key: string) => key.replace(/[^a-z0-9._-]/gi, "_").slice(0, 180);

export async function cached(key: string, make: () => Promise<Buffer | null>): Promise<Buffer | null> {
  const file = path.join(DIR, safe(key));
  try {
    return await readFile(file);
  } catch {}
  const body = await make();
  if (body) {
    try {
      await mkdir(DIR, { recursive: true });
      await writeFile(file, body);
    } catch {}
  }
  return body;
}
