"use client";
import { useActionState } from "react";
import { changePasswordAction, updateProfileAction, type ProfileState } from "./actions";

function Msg({ state }: { state: ProfileState }) {
  if (state?.error) return <p className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</p>;
  if (state?.ok) return <p className="rounded bg-green-50 p-2 text-sm text-green-800">{state.ok}</p>;
  return null;
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfileAction, null);
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Your details</h2>
      <label className="block"><span className="label">Name</span><input className="input" name="name" defaultValue={name} required /></label>
      <label className="block"><span className="label">Email (used to sign in)</span><input className="input" type="email" name="email" defaultValue={email} required /></label>
      <label className="block">
        <span className="label">Current password</span>
        <input className="input" type="password" name="currentPassword" autoComplete="current-password" />
        <span className="mt-1 block text-xs text-slate-400">Only needed if you change your email.</span>
      </label>
      <Msg state={state} />
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<ProfileState, FormData>(changePasswordAction, null);
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Change password</h2>
      <label className="block"><span className="label">Current password</span><input className="input" type="password" name="currentPassword" autoComplete="current-password" required /></label>
      <label className="block"><span className="label">New password (10+ characters)</span><input className="input" type="password" name="newPassword" autoComplete="new-password" minLength={10} required /></label>
      <label className="block"><span className="label">Repeat new password</span><input className="input" type="password" name="confirmPassword" autoComplete="new-password" minLength={10} required /></label>
      <Msg state={state} />
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Change password"}</button>
    </form>
  );
}
