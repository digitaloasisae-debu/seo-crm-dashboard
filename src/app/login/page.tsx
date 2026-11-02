import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">SEO Control Center</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in with your team account.</p>
        <LoginForm />
      </div>
    </main>
  );
}
