"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";
import { Spinner } from "@/components/spinner";

export function LoginForm() {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" required autoComplete="current-password" placeholder="••••••••••" />
      </label>
      {error && <p className="animate-fade-in rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}
      <button className="btn-primary w-full py-2.5" disabled={pending}>
        {pending ? <><Spinner /> Signing in…</> : "Sign in"}
      </button>
    </form>
  );
}
