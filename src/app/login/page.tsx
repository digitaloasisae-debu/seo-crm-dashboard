import { LoginForm } from "./form";
import { Icon } from "@/components/icons";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-4">
      <div className="pointer-events-none absolute top-[-10%] left-[-10%] h-[28rem] w-[28rem] animate-float rounded-full bg-indigo-500/30 blur-3xl" />
      <div className="pointer-events-none absolute right-[-10%] bottom-[-15%] h-[30rem] w-[30rem] animate-float rounded-full bg-fuchsia-500/20 blur-3xl [animation-delay:-5s]" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 h-64 w-64 animate-float rounded-full bg-sky-400/10 blur-3xl [animation-delay:-9s]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" }}
      />
      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <span className="mb-4 flex h-14 w-14 animate-pop items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-2xl shadow-fuchsia-500/40">
            <Icon name="sparkles" className="h-7 w-7" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">SEO Control Center</h1>
          <p className="mt-1 text-sm text-indigo-200/70">Sign in with your team account</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/95 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
