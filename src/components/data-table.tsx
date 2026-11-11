"use client";

/**
 * One table for every list in Rankflow: search, sort by any column, a filter on every column
 * (text contains, number ranges like ">100" or "10-50", pick-list for statuses, date ranges),
 * quick filter chips, show/hide columns, CSV export and bulk selection.
 * The server passes plain values (for sorting and filtering) plus the rendered cells.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

export type ColType = "text" | "number" | "enum" | "date";
export type Col = {
  key: string;
  label: string;
  type?: ColType;
  /** Tooltip on the header. */
  title?: string;
  align?: "left" | "right" | "center";
  /** Hidden until the user turns it on in "Columns". */
  hidden?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  className?: string;
};
export type Row = {
  id: string;
  values: Record<string, string | number | null | undefined>;
  cells?: Record<string, ReactNode>;
  /** Can be ticked for bulk actions (default true when the table has bulk actions). */
  selectable?: boolean;
  className?: string;
};
type Filter = string | string[];
export type Preset = { label: string; filters: Record<string, Filter>; tone?: string };

const DATE_PRESETS: [string, string][] = [["", "Any time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["older30", "Older than 30 days"], ["none", "Not set"]];

function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

/** ">100", ">=5", "<10", "10-50", "=3", "12" (exact). Empty = no filter. */
function numberTest(expr: string): ((n: number | null) => boolean) | null {
  const e = expr.replace(/[\s,]/g, "");
  if (!e) return null;
  let m = e.match(/^(-?\d*\.?\d+)-(-?\d*\.?\d+)$/);
  if (m) { const a = +m[1], b = +m[2]; return (n) => n != null && n >= Math.min(a, b) && n <= Math.max(a, b); }
  m = e.match(/^(>=|<=|>|<|=)?(-?\d*\.?\d+)$/);
  if (m) {
    const v = +m[2];
    const op = m[1] ?? "=";
    return (n) => n != null && (op === ">" ? n > v : op === "<" ? n < v : op === ">=" ? n >= v : op === "<=" ? n <= v : n === v);
  }
  if (e === "empty" || e === "-") return (n) => n == null;
  return () => true;
}

function matches(row: Row, col: Col, f: Filter): boolean {
  const v = row.values[col.key];
  const type = col.type ?? "text";
  if (type === "enum") {
    const list = f as string[];
    return !list.length || list.includes(v == null || v === "" ? "(empty)" : String(v));
  }
  if (type === "number") {
    const t = numberTest(String(f));
    return !t || t(v == null || v === "" ? null : Number(v));
  }
  if (type === "date") {
    if (!f) return true;
    if (f === "none") return !v;
    if (!v) return false;
    const age = (Date.now() - new Date(String(v)).getTime()) / 864e5;
    return f === "older30" ? age > 30 : age <= Number(f);
  }
  const q = String(f).trim().toLowerCase();
  return !q || String(v ?? "").toLowerCase().includes(q);
}

const isActive = (f: Filter | undefined) => (Array.isArray(f) ? f.length > 0 : !!f && String(f).trim() !== "");

export function DataTable({
  id,
  columns,
  rows,
  bulk,
  presets,
  toolbar,
  empty = "Nothing here yet.",
  pageSize = 50,
  defaultSort,
  searchPlaceholder = "Search",
  initialFilters,
  bare,
}: {
  /** Already inside a card: drop the table's own card frame. */
  bare?: boolean;
  /** Filters to start with (e.g. from a link like ?status=PENDING); they win over remembered ones. */
  initialFilters?: Record<string, Filter>;
  /** Saves column choices and sort per table. */
  id: string;
  columns: Col[];
  rows: Row[];
  /** Buttons shown when rows are ticked (put the table inside a form with formAction buttons). */
  bulk?: ReactNode;
  presets?: Preset[];
  toolbar?: ReactNode;
  empty?: ReactNode;
  pageSize?: number;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, Filter>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(defaultSort ?? null);
  const [hidden, setHidden] = useState<string[]>(() => columns.filter((c) => c.hidden).map((c) => c.key));
  const [showFilters, setShowFilters] = useState(true);
  const [limit, setLimit] = useState(pageSize);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  // Restore saved choices after the first render (localStorage isn't there on the server).
  useEffect(() => {
    const s = store<{ hidden?: string[]; sort?: typeof sort; showFilters?: boolean; filters?: Record<string, Filter> }>(`rf-table:${id}`, {});
    if (s.hidden) setHidden(s.hidden.filter((k) => columns.some((c) => c.key === k)));
    if (s.sort !== undefined) setSort(s.sort);
    if (s.showFilters !== undefined) setShowFilters(s.showFilters);
    if (initialFilters && Object.keys(initialFilters).length) setFilters(initialFilters);
    else {
      try {
        const f = sessionStorage.getItem(`rf-table-f:${id}`);
        if (f) setFilters(JSON.parse(f));
      } catch { /* ignore */ }
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!ready) return;
    save(`rf-table:${id}`, { hidden, sort, showFilters });
    try { sessionStorage.setItem(`rf-table-f:${id}`, JSON.stringify(filters)); } catch { /* ignore */ }
  }, [id, hidden, sort, showFilters, filters, ready]);
  useEffect(() => setLimit(pageSize), [q, filters, sort, pageSize]);

  const visible = columns.filter((c) => !hidden.includes(c.key));
  const enumOptions = useMemo(() => {
    const out: Record<string, [string, number][]> = {};
    for (const c of columns) {
      if (c.type !== "enum") continue;
      const m = new Map<string, number>();
      for (const r of rows) { const v = r.values[c.key]; const k = v == null || v === "" ? "(empty)" : String(v); m.set(k, (m.get(k) ?? 0) + 1); }
      out[c.key] = [...m.entries()].sort((a, b) => b[1] - a[1]);
    }
    return out;
  }, [columns, rows]);

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let out = rows.filter((r) => {
      for (const c of columns) { const f = filters[c.key]; if (isActive(f) && !matches(r, c, f)) return false; }
      if (!words.length) return true;
      const hay = columns.map((c) => String(r.values[c.key] ?? "")).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => {
          const x = a.values[sort.key], y = b.values[sort.key];
          const xe = x == null || x === "", ye = y == null || y === "";
          if (xe || ye) return xe && ye ? 0 : xe ? 1 : -1; // empty always last
          if (col.type === "number") return (Number(x) - Number(y)) * dir;
          if (col.type === "date") return (new Date(String(x)).getTime() - new Date(String(y)).getTime()) * dir;
          return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) * dir;
        });
      }
    }
    return out;
  }, [rows, columns, filters, q, sort]);

  const shown = filtered.slice(0, limit);
  const activeCount = Object.values(filters).filter(isActive).length + (q.trim() ? 1 : 0);
  const selectableIds = filtered.filter((r) => r.selectable !== false).map((r) => r.id);
  const allPicked = selectableIds.length > 0 && selectableIds.every((x) => picked.has(x));
  const presetOn = (p: Preset) => Object.entries(p.filters).every(([k, v]) => JSON.stringify(filters[k] ?? (Array.isArray(v) ? [] : "")) === JSON.stringify(v)) && Object.entries(filters).every(([k, v]) => !isActive(v) || k in p.filters);

  const setF = (key: string, v: Filter) => setFilters((f) => ({ ...f, [key]: v }));
  const clearAll = () => { setFilters({}); setQ(""); };
  const toggleSort = (key: string) => {
    const t = columns.find((c) => c.key === key)?.type;
    const first: "asc" | "desc" = t === "number" || t === "date" ? "desc" : "asc";
    setSort((s) => (!s || s.key !== key ? { key, dir: first } : s.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : null));
  };

  const exportCsv = () => {
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [visible.map((c) => esc(c.label)).join(","), ...filtered.map((r) => visible.map((c) => esc(r.values[c.key])).join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${id.replace(/[^a-z0-9-]+/gi, "-")}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className={bare ? "overflow-hidden border-t border-slate-200" : "card overflow-hidden !p-0"}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <label className="relative flex min-w-48 flex-1 items-center sm:max-w-xs">
          <Icon name="search" className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="input !py-2 !pl-9 text-sm" aria-label="Search this table" />
          {q && <button type="button" onClick={() => setQ("")} className="absolute right-2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search"><Icon name="x" className="h-3.5 w-3.5" /></button>}
        </label>
        {presets?.map((p) => (
          <button key={p.label} type="button" onClick={() => (presetOn(p) ? clearAll() : (setQ(""), setFilters(p.filters)))} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${presetOn(p) ? "bg-indigo-600 text-white shadow-sm" : `bg-slate-100 text-slate-600 hover:bg-slate-200 ${p.tone ?? ""}`}`}>
            {p.label}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={() => setShowFilters((s) => !s)} className={`btn-secondary gap-1.5 px-2.5 py-1.5 text-xs ${showFilters ? "border-indigo-200 text-indigo-700" : ""}`} title="Show or hide the filter under each column">
          <Icon name="filter" className="h-3.5 w-3.5" /> Filters{activeCount > 0 && <span className="num rounded-full bg-indigo-600 px-1.5 text-[10px] text-white">{activeCount}</span>}
        </button>
        <ColumnsMenu columns={columns} hidden={hidden} setHidden={setHidden} />
        <button type="button" onClick={exportCsv} className="btn-secondary gap-1.5 px-2.5 py-1.5 text-xs" title="Download what you see as a CSV file">
          <Icon name="download" className="h-3.5 w-3.5" /> CSV
        </button>
        {toolbar}
      </div>

      {/* Active filters and bulk bar */}
      {(activeCount > 0 || picked.size > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          {picked.size > 0 && bulk ? (
            <>
              <span className="num font-semibold text-indigo-700">{picked.size} selected</span>
              <button type="button" className="text-slate-500 hover:text-slate-900 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <div className="flex flex-wrap gap-2">{bulk}</div>
            </>
          ) : (
            <>
              <span className="text-slate-500">Filtered by</span>
              {q.trim() && <Chip label={`"${q.trim()}"`} onClear={() => setQ("")} />}
              {columns.filter((c) => isActive(filters[c.key])).map((c) => (
                <Chip key={c.key} label={`${c.label}: ${describe(c, filters[c.key])}`} onClear={() => setF(c.key, Array.isArray(filters[c.key]) ? [] : "")} />
              ))}
              <button type="button" onClick={clearAll} className="font-medium text-indigo-600 hover:underline">Clear all</button>
            </>
          )}
        </div>
      )}

      <div className="max-h-[75vh] overflow-auto">
        <table className="table">
          <thead className="sticky top-0 z-10">
            <tr>
              {bulk && (
                <th className="w-10 !rounded-none">
                  <input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(selectableIds))} className="accent-indigo-600" />
                </th>
              )}
              {visible.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} title={c.title} className={`!rounded-none whitespace-nowrap ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}`}>
                    {c.sortable === false ? c.label : (
                      <button type="button" onClick={() => toggleSort(c.key)} className={`group inline-flex cursor-pointer items-center gap-1 uppercase transition-colors hover:text-slate-900 ${on ? "text-indigo-700" : ""}`}>
                        {c.label}
                        <Icon name="chevron" className={`h-3 w-3 transition ${on ? (sort!.dir === "asc" ? "rotate-180 opacity-100" : "opacity-100") : "opacity-0 group-hover:opacity-50"}`} />
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
            {showFilters && (
              <tr>
                {bulk && <th className="!rounded-none !py-1.5" />}
                {visible.map((c) => (
                  <th key={c.key} className="!rounded-none !py-1.5 font-normal normal-case tracking-normal">
                    {c.filterable === false ? null : <ColumnFilter col={c} value={filters[c.key]} options={enumOptions[c.key]} onChange={(v) => setF(c.key, v)} />}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={`${r.className ?? ""} ${picked.has(r.id) ? "!bg-indigo-50/60" : ""}`}>
                {bulk && (
                  <td className="w-10">
                    {r.selectable !== false && (
                      <input type="checkbox" name="ids" value={r.id} checked={picked.has(r.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="accent-indigo-600" aria-label="Select row" />
                    )}
                  </td>
                )}
                {visible.map((c) => (
                  <td key={c.key} className={`${c.className ?? ""} ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}`}>
                    {r.cells && c.key in r.cells ? r.cells[c.key] : r.values[c.key] == null || r.values[c.key] === "" ? <span className="text-slate-300">—</span> : c.type === "number" ? <span className="num">{Number(r.values[c.key]).toLocaleString()}</span> : c.type === "date" ? String(r.values[c.key]).slice(0, 10) : String(r.values[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            {rows.length === 0 ? empty : <>Nothing matches these filters. <button type="button" onClick={clearAll} className="font-medium text-indigo-600 hover:underline">Clear filters</button></>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
        <span className="num">{filtered.length === rows.length ? `${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}` : `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()}`}</span>
        {filtered.length > limit && (
          <>
            <span className="flex-1" />
            <span className="num">Showing {limit}</span>
            <button type="button" onClick={() => setLimit((l) => l + pageSize)} className="btn-secondary px-2.5 py-1 text-xs">Show {Math.min(pageSize, filtered.length - limit)} more</button>
            <button type="button" onClick={() => setLimit(filtered.length)} className="font-medium text-indigo-600 hover:underline">Show all</button>
          </>
        )}
      </div>
    </div>
  );
}

function describe(c: Col, f: Filter) {
  if (Array.isArray(f)) return f.length > 2 ? `${f.slice(0, 2).join(", ")} +${f.length - 2}` : f.join(", ");
  if (c.type === "date") return DATE_PRESETS.find(([k]) => k === f)?.[1] ?? f;
  return f;
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex max-w-72 items-center gap-1 rounded-full bg-white py-0.5 pr-1 pl-2.5 font-medium text-slate-700 ring-1 ring-slate-200">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800" aria-label={`Remove ${label}`}><Icon name="x" className="h-3 w-3" /></button>
    </span>
  );
}

function ColumnFilter({ col, value, options, onChange }: { col: Col; value: Filter | undefined; options?: [string, number][]; onChange: (v: Filter) => void }) {
  const type = col.type ?? "text";
  const base = "w-full min-w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";
  if (type === "enum") return <EnumFilter value={(value as string[]) ?? []} options={options ?? []} onChange={onChange} />;
  if (type === "date")
    return (
      <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={`${base} ${value ? "border-indigo-300 bg-indigo-50" : ""}`} aria-label={`Filter ${col.label}`}>
        {DATE_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
  return (
    <input
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={type === "number" ? ">10, 5-20" : "Contains…"}
      title={type === "number" ? "Type 100, >100, <=50 or 10-50" : undefined}
      className={`${base} ${type === "number" ? "max-w-28" : ""} ${isActive(value) ? "border-indigo-300 bg-indigo-50" : ""}`}
      aria-label={`Filter ${col.label}`}
    />
  );
}

function EnumFilter({ value, options, onChange }: { value: string[]; options: [string, number][]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const away = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", away);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); window.removeEventListener("resize", away); };
  }, [open]);
  const toggle = () => {
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 236) });
    setOpen((o) => !o);
  };
  const label = !value.length ? "All" : value.length === 1 ? value[0] : `${value.length} picked`;
  return (
    <>
      <button ref={btn} type="button" onClick={toggle} className={`flex w-full min-w-24 items-center justify-between gap-1 rounded-lg border px-2 py-1 text-left text-xs transition ${value.length ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
        <span className="truncate capitalize">{label.toLowerCase().replace(/_/g, " ")}</span>
        <Icon name="chevron" className={`h-3 w-3 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div ref={pop} className="rf-pop fixed z-[70] w-56 rounded-xl border border-slate-200 bg-white p-1.5 text-xs" style={{ top: pos.top, left: pos.left, boxShadow: "var(--shadow-pop)" }}>
          <div className="max-h-64 overflow-auto">
            {options.map(([v, n]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <input type="checkbox" checked={value.includes(v)} onChange={() => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])} className="accent-indigo-600" />
                <span className="flex-1 truncate capitalize">{v.toLowerCase().replace(/_/g, " ")}</span>
                <span className="num text-slate-400">{n}</span>
              </label>
            ))}
            {options.length === 0 && <div className="px-2 py-1.5 text-slate-400">No values</div>}
          </div>
          {value.length > 0 && <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left font-medium text-indigo-600 hover:bg-indigo-50">Show all</button>}
        </div>,
        document.body,
      )}
    </>
  );
}

function ColumnsMenu({ columns, hidden, setHidden }: { columns: Col[]; hidden: string[]; setHidden: (h: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const off = hidden.length;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-secondary gap-1.5 px-2.5 py-1.5 text-xs" title="Choose which columns to show">
        <Icon name="columns" className="h-3.5 w-3.5" /> Columns{off > 0 && <span className="num text-slate-400">{columns.length - off}/{columns.length}</span>}
      </button>
      {open && (
        <div className="rf-pop absolute right-0 z-30 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-1.5 text-xs" style={{ boxShadow: "var(--shadow-pop)" }}>
          {columns.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => setHidden(hidden.includes(c.key) ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])} className="accent-indigo-600" />
              {c.label}
            </label>
          ))}
          <div className="mt-1 flex justify-between border-t border-slate-100 px-2 pt-1.5">
            <button type="button" onClick={() => setHidden([])} className="font-medium text-indigo-600 hover:underline">Show all</button>
            <button type="button" onClick={() => setHidden(columns.filter((c) => c.hidden).map((c) => c.key))} className="text-slate-500 hover:underline">Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
