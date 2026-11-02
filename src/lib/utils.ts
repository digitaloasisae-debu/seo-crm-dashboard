export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Split a Tally/Sheets text answer into a clean list (commas or new lines). */
export function splitList(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function normalizeKeyword(k: string): string {
  return k.trim().replace(/\s+/g, " ").toLowerCase();
}

export function yes(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return ["yes", "true", "1", "y"].includes(String(v ?? "").trim().toLowerCase());
}

export function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}
