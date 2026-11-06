import { LoginForm } from "./form";
import { LogoMark } from "@/components/logo";
import { BRAND } from "@/lib/brand";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0d0e19] p-4">
      <div className="pointer-events-none absolute top-[-10%] left-[-10%] h-[28rem] w-[28rem] animate-float rounded-full bg-indigo-500/30 blur-3xl" />
      <div className="pointer-events-none absolute right-[-10%] bottom-[-15%] h-[30rem] w-[30rem] animate-float rounded-full bg-fuchsia-500/20 blur-3xl [animation-delay:-5s]" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 h-64 w-64 animate-float rounded-full bg-sky-400/10 blur-3xl [animation-delay:-9s]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" }}
      />
      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <span className="mb-4 animate-pop"><LogoMark size={64} animated className="drop-shadow-[0_12px_30px_rgba(217,70,239,0.45)]" /></span>
          <h1 className="text-3xl font-bold tracking-tight">{BRAND.name.slice(0, 4)}<span className="bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent">{BRAND.name.slice(4)}</span></h1>
          <p className="mt-1 text-sm text-indigo-200/70">{BRAND.tagline}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/95 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
