// Creates the Super Admin from SEED_ADMIN_* env vars. Safe to run more than once
// (also runs on every Vercel deploy via `vercel-build`; an existing password is never changed).
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  const name = process.env.SEED_ADMIN_NAME ?? "Super Admin";
  if (!email || password.length < 10) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (10+ characters) in .env");

  const user = await db.user.upsert({
    where: { email },
    create: { email, name, role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(password, 12) },
    update: { role: "SUPER_ADMIN", active: true },
  });
  console.log(`Super Admin ready: ${user.name} <${user.email}>`);
}

main().finally(() => db.$disconnect());
