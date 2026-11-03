import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { authUrl, googleConfigured } from "@/lib/google";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "SUPER_ADMIN") return NextResponse.redirect(new URL("/login", req.url));
  if (!googleConfigured()) return NextResponse.redirect(new URL("/google?error=not_configured", req.url));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("g_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/google" });
  return res;
}
