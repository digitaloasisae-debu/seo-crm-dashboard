import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Webhooks and the n8n API authenticate themselves; everything else needs a login.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
