import { LoginForm } from "./form";
import { Logo } from "@/components/logo";
import { BRAND } from "@/lib/brand";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-slate-50 lg:grid-cols-2">
      <div className="flex flex-col p-6 md:p-10">
        <Logo size={28} />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
            <p className="mt-1 mb-6 text-sm text-slate-500">Welcome back. Use the email your agency invited.</p>
            <LoginForm />
          </div>
        </div>
        <p className="text-xs text-slate-400">{BRAND.tagline}</p>
      </div>
      <div className="relative hidden overflow-hidden border-l border-slate-200 bg-slate-100 lg:block">
        {/* A calm product glimpse instead of decoration: what the team does here every day. */}
        <div className="absolute inset-0 flex items-center justify-center p-12">
          <div className="w-full max-w-md space-y-3">
            {[
              ["Ready for review", "10 signs your water heater needs replacing", "Article"],
              ["Approved", "emergency plumber near me", "Keyword"],
              ["On WordPress", "How much does a new roof cost in 2026?", "Article"],
            ].map(([status, title, kind], i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4" style={{ boxShadow: "var(--shadow-card)", opacity: 1 - i * 0.18 }}>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{kind}</span>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{status}</span>
                </div>
                <div className="mt-1.5 text-sm font-medium text-slate-900">{title}</div>
              </div>
            ))}
            <p className="pt-4 text-sm text-slate-500">Keywords, articles, audits and Google profiles for every client, in one queue.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
