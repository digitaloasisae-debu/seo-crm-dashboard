import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// On Vercel every request is its own small function, so a tiny pool is right. On the VPS one long-running
// server handles every page and image at once, so give it more database connections (Supabase's pooler allows it).
function url() {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.VERCEL) return undefined;
  try {
    const u = new URL(raw);
    const now = Number(u.searchParams.get("connection_limit") || 0);
    if (now >= 10) return undefined;
    u.searchParams.set("connection_limit", "10");
    return u.toString();
  } catch {
    return undefined;
  }
}

const datasourceUrl = url();
export const db = globalForPrisma.prisma ?? new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

globalForPrisma.prisma = db;
