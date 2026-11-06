"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./icons";

/* ---------------- Toasts ---------------- */

type ToastMsg = { id: number; text: string; undo?: () => void; tone?: "ok" | "err" };
let nextId = 1;

/** Show a toast from any client component. Pass `undo` to add an Undo button. */
export function toast(text: string, opts: { undo?: () => void; tone?: "ok" | "err" } = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastMsg>("rf-toast", { detail: { id: nextId++, text, ...opts } }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<ToastMsg>).detail;
      setItems((s) => [...s.slice(-2), t]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), t.undo ? 5500 : 3500);
    };
    window.addEventListener("rf-toast", on);
    return () => window.removeEventListener("rf-toast", on);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[80] grid -translate-x-1/2 gap-2" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      {items.map((t) => (
        <div key={t.id} className="rf-toast pointer-events-auto flex max-w-[90vw] items-center gap-4 rounded-2xl bg-slate-900 py-2.5 pr-3 pl-4 text-sm text-slate-50" style={{ boxShadow: "var(--shadow-pop)" }}>
          {t.tone === "err" ? <Icon name="alert" className="h-4 w-4 shrink-0 text-red-300" /> : <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-300" />}
          <span className="min-w-0 truncate">{t.text}</span>
          {t.undo && (
            <button
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 font-semibold underline-offset-4 hover:underline"
              onClick={() => {
                t.undo!();
                setItems((s) => s.filter((x) => x.id !== t.id));
              }}
            >
              <Icon name="undo" className="h-3.5 w-3.5" /> Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Theme ---------------- */

type Mode = "light" | "dark" | "system";
function applyTheme(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const set = () => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.themeMode = mode;
  };
  const d = document as Document & { startViewTransition?: (cb: () => void) => void };
  if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(set);
  else set();
  try {
    localStorage.setItem("theme", mode);
  } catch {}
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    setMode((document.documentElement.dataset.themeMode as Mode) || "system");
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => document.documentElement.dataset.themeMode === "system" && applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const next: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
  const icon: Record<Mode, IconName> = { system: "sun", light: "sun", dark: "moon" };
  const label: Record<Mode, string> = { system: "Theme: matches your device", light: "Theme: light", dark: "Theme: dark" };
  return (
    <button
      type="button"
      title={`${label[mode]} (click to change)`}
      aria-label={label[mode]}
      onClick={() => {
        const m = next[mode];
        setMode(m);
        applyTheme(m);
      }}
      className="relative grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
    >
      <Icon name={icon[mode]} className="h-[18px] w-[18px]" />
      {mode === "system" && <span className="absolute right-1.5 bottom-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500" />}
    </button>
  );
}

/* ---------------- Command menu (⌘K) ---------------- */

export type PaletteClient = { id: string; name: string; site: string };
type Cmd = { id: string; label: string; hint: string; icon: IconName; href?: string; run?: () => void; keywords?: string };

export function CommandMenu({ clients, links }: { clients: PaletteClient[]; links: { href: string; label: string; icon: IconName }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    const base: Cmd[] = [
      { id: "review", label: "Start reviewing the queue", hint: "Action", icon: "check", href: "/?review=1", keywords: "approve keywords topics articles" },
      ...links.map((l) => ({ id: `go${l.href}`, label: `Go to ${l.label}`, hint: "Page", icon: l.icon, href: l.href })),
      { id: "theme", label: "Switch light / dark", hint: "Action", icon: "moon", run: () => document.querySelector<HTMLButtonElement>("[aria-label^='Theme']")?.click(), keywords: "theme dark mode" },
    ];
    const tabs: [string, string, IconName][] = [
      ["", "Overview", "briefcase"],
      ["/keywords", "Keywords", "tag"],
      ["/topics", "Topics", "lightbulb"],
      ["/articles", "Articles", "file"],
      ["/audit", "Site audit", "stethoscope"],
      ["/gbp", "Google profile", "pin"],
      ["/backlinks", "Backlinks", "link"],
      ["/analytics", "Analytics", "activity"],
    ];
    const per: Cmd[] = clients.flatMap((c) =>
      tabs.map(([path, tab, icon]) => ({ id: `${c.id}${path}`, label: path ? `${c.name} › ${tab}` : c.name, hint: path ? "Client page" : c.site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), icon, href: `/clients/${c.id}${path}`, keywords: c.site })),
    );
    return [...base, ...per];
  }, [clients, links]);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [...cmds.filter((c) => !c.label.includes("›")).slice(0, 12)];
    return cmds.filter((c) => words.every((w) => `${c.label} ${c.hint} ${c.keywords ?? ""}`.toLowerCase().includes(w))).slice(0, 30);
  }, [q, cmds]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setSel(0);
  }, []);
  const run = useCallback(
    (c?: Cmd) => {
      if (!c) return;
      close();
      if (c.run) c.run();
      else if (c.href) router.push(c.href);
    },
    [close, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("rf-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("rf-palette", onOpen);
    };
  }, [open]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid animate-fade-in items-start justify-items-center bg-slate-950/30 px-4 pt-[12vh] dark:bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Command menu" className="rf-pal w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4">
          <Icon name="search" className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, list.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              if (e.key === "Enter") run(list[sel]);
              if (e.key === "Escape") close();
            }}
            placeholder="Type a client, a page or an action…"
            className="w-full bg-transparent py-4 text-base outline-none placeholder:text-slate-400"
          />
        </div>
        <ul ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">Nothing matches "{q}"</li>}
          {list.map((c, i) => (
            <li
              key={c.id}
              data-i={i}
              onMouseMove={() => setSel(i)}
              onClick={() => run(c)}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${i === sel ? "bg-indigo-50 text-indigo-700" : "text-slate-700"}`}
            >
              <Icon name={c.icon} className={`h-4 w-4 shrink-0 ${i === sel ? "text-indigo-600" : "text-slate-400"}`} />
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              <span className="shrink-0 text-xs text-slate-400">{c.hint}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-4 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-400">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span>
          <span><Kbd>Enter</Kbd> open</span>
          <span><Kbd>Esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}

export function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <kbd className={`rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-500 ${className}`}>{children}</kbd>;
}

export function SearchButton() {
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("rf-palette"))}
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm text-slate-400 transition hover:border-indigo-300 hover:ring-4 hover:ring-indigo-500/10 md:max-w-lg"
    >
      <Icon name="search" className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Jump to a client, run an audit, approve…</span>
      <Kbd className="hidden sm:inline">{mac ? "⌘K" : "Ctrl K"}</Kbd>
    </button>
  );
}
