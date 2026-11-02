"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" required autoComplete="email" />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" required autoComplete="current-password" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
