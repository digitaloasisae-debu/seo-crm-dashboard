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
      <div className="rf-side relative hidden overflow-hidden lg:block">
        {/* Rankflow, in four steps: what the team does here every day. */}
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full" style={{ background: "radial-gradient(closest-side, rgb(100 97 214 / 0.55), transparent)" }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full" style={{ background: "radial-gradient(closest-side, rgb(245 184 61 / 0.18), transparent)" }} />
        <div className="relative flex h-full flex-col justify-center p-14 xl:p-20">
          <span className="w-fit rounded-full px-3 py-1 text-xs font-medium" style={{ background: "rgb(245 184 61 / 0.15)", color: "#f5b83d" }}>{BRAND.tagline}</span>
          <h2 className="mt-5 max-w-md font-display text-4xl leading-tight font-semibold tracking-tight text-white">
            From keyword to <span style={{ color: "#f5b83d" }}>page one</span>, for every client.
          </h2>
          <p className="rf-side-muted mt-4 max-w-md text-base" style={{ color: "rgb(226 226 248 / 0.7)" }}>
            Rankflow runs your agency&apos;s SEO content in one place, so nothing gets lost in a spreadsheet.
          </p>
          <ol className="mt-10 max-w-md space-y-3">
            {[
              ["Collect keywords", "Clients and the team send them in. They land in one review queue."],
              ["Write with AI", "Approved topics become full blog drafts in the client's own voice."],
              ["Review and publish", "Read, tweak and send the article to WordPress in one click."],
              ["Track and grow", "Watch rankings, catch pages losing traffic and win them back."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4 rounded-xl p-4" style={{ background: "rgb(255 255 255 / 0.05)", border: "1px solid rgb(255 255 255 / 0.08)" }}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold" style={{ background: i === 3 ? "#f5b83d" : "rgb(255 255 255 / 0.1)", color: i === 3 ? "#1c1b45" : "#fff" }}>{i + 1}</span>
                <span>
                  <span className="block text-sm font-semibold text-white">{t}</span>
                  <span className="mt-0.5 block text-sm" style={{ color: "rgb(226 226 248 / 0.65)" }}>{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </main>
  );
}
