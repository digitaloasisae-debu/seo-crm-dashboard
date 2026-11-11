import Link from "next/link";
import { CopyChip } from "@/components/copy-chip";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/ui";
import { clientArticles, linkIdeas, usageIn } from "@/lib/keyword-usage";

type Source = { url: string; title?: string; kind?: string };
const KIND: Record<string, string> = { competitor: "Competitor pages it studied", client_site: "Client's own website", external: "Suggested outside links", research: "Research pages" };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const path = (u: string) => { try { const x = new URL(u); return (x.pathname + x.search).replace(/\/$/, "") || "/"; } catch { return ""; } };

function SourceRow({ s, sub }: { s: Source; sub?: string }) {
  return (
    <li className="group flex items-start gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-slate-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://www.google.com/s2/favicons?domain=${host(s.url)}&sz=32`} alt="" className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
      <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-800 group-hover:text-indigo-700 group-hover:underline">{s.title || host(s.url)}</span>
        <span className="block truncate text-xs text-slate-400">{s.title ? host(s.url) : ""}{path(s.url)}{sub ? ` · ${sub}` : ""}</span>
      </a>
      <Icon name="external" className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-600" />
    </li>
  );
}

/** Where the content came from: research pages n8n sent, plus every outside link in the text. */
export function Sources({ sources, bodyHtml, siteUrl, competitors, writtenHere }: { sources: Source[] | null; bodyHtml: string; siteUrl: string; competitors: string[]; writtenHere: boolean }) {
  const own = host(siteUrl);
  const links = new Map<string, { url: string; text: string }>();
  for (const m of bodyHtml.matchAll(/<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (host(m[1]) === own || links.has(m[1])) continue;
    links.set(m[1], { url: m[1], text: m[2].replace(/<[^>]+>/g, "").trim() });
  }
  const groups = new Map<string, Source[]>();
  for (const s of sources ?? []) groups.set(s.kind ?? "research", [...(groups.get(s.kind ?? "research") ?? []), s]);
  const none = !sources?.length && links.size === 0;
  return (
    <section id="sources" className="card scroll-mt-20 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-sans text-sm font-semibold tracking-normal">Sources</h3>
        <span className="text-xs text-slate-500">{(sources?.length ?? 0) + links.size} link{(sources?.length ?? 0) + links.size === 1 ? "" : "s"}</span>
      </div>
      {[...groups].map(([k, list]) => (
        <div key={k}>
          <div className="mb-0.5 text-xs font-medium text-slate-500">{KIND[k] ?? k.replace(/_/g, " ")}</div>
          <ul>{list.map((s) => <SourceRow key={s.url} s={s} />)}</ul>
        </div>
      ))}
      {!sources?.length && writtenHere && (
        <div className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-600">
          n8n hasn&apos;t sent its sources for this article. Newer articles list them once the n8n update is in.
          {competitors.length > 0 && <> While writing, n8n reads the client&apos;s first two competitor sites: {competitors.slice(0, 2).map((c, i) => <span key={c}>{i ? ", " : ""}<a href={c.startsWith("http") ? c : `https://${c}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{host(c.startsWith("http") ? c : `https://${c}`)}</a></span>)}.</>}
        </div>
      )}
      {links.size > 0 && (
        <div>
          <div className="mb-0.5 text-xs font-medium text-slate-500">Outside links in the text</div>
          <ul>{[...links.values()].map((l) => <SourceRow key={l.url} s={{ url: l.url, title: l.text || undefined }} sub={l.text ? undefined : "linked in the text"} />)}</ul>
        </div>
      )}
      {none && !writtenHere && <p className="text-sm text-slate-500">This page has no outside links.</p>}
    </section>
  );
}

/** Is the focus keyword already taken by another blog, and which live pages to link to for it. */
export async function KeywordCheck({ articleId, clientId, keyword, bodyHtml }: { articleId: string; clientId: string; keyword: string; bodyHtml: string }) {
  const [arts, ideas] = await Promise.all([clientArticles(clientId), linkIdeas(clientId, keyword, { excludeId: articleId, bodyHtml, limit: 6 })]);
  const used = usageIn(arts, keyword, articleId);
  const same = used.filter((u) => u.match === "same");
  return (
    <section id="keyword" className="card scroll-mt-20 space-y-3">
      <h3 className="font-sans text-sm font-semibold tracking-normal">Keyword check</h3>
      {used.length === 0 ? (
        <p className="flex items-start gap-2 rounded-md bg-emerald-50 p-2.5 text-sm text-emerald-800"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" /> No other blog on this site targets &ldquo;{keyword}&rdquo;.</p>
      ) : (
        <div className={`space-y-2 rounded-md p-2.5 text-sm ${same.length ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700"}`}>
          <p className="flex items-start gap-2">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{same.length ? <>Already used. {same.length === 1 ? "Another blog targets" : `${same.length} other blogs target`} the same keyword, so they will compete with each other on Google.</> : <>A similar keyword is already used. Make sure the two blogs answer different questions.</>}</span>
          </p>
          <ul className="space-y-1 pl-6">
            {used.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Link href={`/articles/${u.id}`} className="font-medium underline-offset-2 hover:underline">{u.title}</Link>
                <span className="text-xs opacity-70">{u.match === "similar" ? "similar: " : ""}&ldquo;{u.keyword}&rdquo;{u.imported ? " · live page" : ""}</span>
                <StatusBadge status={u.status} />
              </li>
            ))}
          </ul>
          {same.length > 0 && <p className="pl-6 text-xs opacity-80">Fix: give this blog a different focus keyword or angle, or merge the two and link this one to the stronger page.</p>}
        </div>
      )}
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">Internal links to add in this blog</span>
          <span className="text-[11px] text-slate-400">most related live pages first</span>
        </div>
        {ideas.length === 0 ? (
          <p className="text-sm text-slate-500">No related live pages found yet. Import the site&apos;s posts and pages on the Articles tab to get ideas.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ideas.map((l) => (
              <li key={l.url} className="flex items-start gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <a href={l.url} target="_blank" rel="noreferrer" className="block truncate font-medium text-slate-800 hover:text-indigo-700 hover:underline">{l.title}</a>
                  <div className="flex flex-wrap items-center gap-x-1 text-xs text-slate-500">
                    Anchor text: <CopyChip text={l.anchor} label="anchor text" className="text-xs text-slate-700" />
                  </div>
                </div>
                {l.linked ? (
                  <span className="mt-0.5 shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700" data-tip="This blog already links to it">Linked</span>
                ) : (
                  <CopyChip text={l.url} label="link" display="Copy link" className="mt-0.5 shrink-0 text-xs text-indigo-600" />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-slate-400">Linking a blog to related pages with the right anchor helps Google understand both. AI rewrites add these automatically.</p>
      </div>
    </section>
  );
}
