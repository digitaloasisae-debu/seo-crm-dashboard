import type { NextAuthConfig } from "next-auth";

// Edge-safe part of the auth config, shared by middleware and the full config in auth.ts.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const path = request.nextUrl.pathname;
      if (path.startsWith("/login")) return true;
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
