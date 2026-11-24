import type { SocialProject } from "@prisma/client";
import { PLATFORMS, PLATFORM_LABEL } from "@/lib/social/ai";

/** The settings form fields of a social project (the old "Projects Config" columns, plus account ids). */
export function ProjectFields({ p, country }: { p?: Partial<SocialProject>; country?: string | null }) {
  const platforms = p?.platforms ?? ["facebook", "instagram", "linkedin"];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="md:col-span-2">
        <span className="label">Targeted services (one per line). Ideas only ever come from these.</span>
        <textarea name="services" rows={4} defaultValue={(p?.services ?? []).join("\n")} className="input" required placeholder={"SEO\nGoogle Ads\nMeta Ads"} />
      </label>
      <fieldset>
        <span className="label">Post to</span>
        <div className="flex gap-4 text-sm">
          {PLATFORMS.map((x) => (
            <label key={x} className="flex items-center gap-1.5"><input type="checkbox" name={`platform_${x}`} defaultChecked={platforms.includes(x)} /> {PLATFORM_LABEL[x]}</label>
          ))}
        </div>
      </fieldset>
      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 md:col-span-2">
        <b>Posting plan:</b> Monday to Saturday, never Sunday. Each week: 2 Reels and 3 images (about 21 posts a month), balanced across informative, hidden promo, service in action and promotional posts, plus holidays and events on their day.
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label><span className="label">From hour</span><input type="number" name="postFromHour" min={0} max={23} defaultValue={p?.postFromHour ?? 10} className="input" /></label>
        <label><span className="label">To hour</span><input type="number" name="postToHour" min={1} max={24} defaultValue={p?.postToHour ?? 19} className="input" /></label>
        <label><span className="label">Country (for holidays and local moments)</span><input name="country" defaultValue={country ?? ""} placeholder="e.g. United States" className="input" /></label>
        <label><span className="label">Time zone</span>
          <select name="timezone" defaultValue={zoneOk(p?.timezone) ? p!.timezone! : "Asia/Dubai"} className="input">
            {[...new Set([...(zoneOk(p?.timezone) ? [p!.timezone!] : []), ...TIMEZONES.map(([z]) => z)])].map((z) => <option key={z} value={z}>{TIMEZONES.find(([x]) => x === z)?.[1] ?? z}</option>)}
          </select>
        </label>
      </div>
      <label>
        <span className="label">Facebook Page ID</span>
        <input name="fbPageId" defaultValue={p?.fbPageId ?? ""} className="input" placeholder="e.g. 631749163362712" />
      </label>
      <label>
        <span className="label">Instagram account ID (blank = the one linked to the Page)</span>
        <input name="igUserId" defaultValue={p?.igUserId ?? ""} className="input" />
      </label>
      <label>
        <span className="label">LinkedIn company page ID (the number in the admin URL)</span>
        <input name="linkedinOrgId" defaultValue={p?.linkedinOrgId ?? ""} className="input" placeholder="e.g. 104567890" />
      </label>
      <label>
        <span className="label">Image style notes (optional)</span>
        <input name="imageStyle" defaultValue={p?.imageStyle ?? ""} className="input" placeholder="e.g. Dubai settings, modern offices, no stock-photo handshakes" />
      </label>
      <label className="flex items-start gap-2 text-sm md:col-span-2"><input type="checkbox" name="ownStyle" defaultChecked={p?.ownStyle ?? false} className="mt-1" /> <span><b>Copy my page&apos;s style.</b> New images copy the look of this account&apos;s own 10-15 best posts (layout, fonts, colours, photos); only the topic and title change. Reels keep the normal look.</span></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Active (included when you generate a month)</label>
    </div>
  );
}

const TIMEZONES: [string, string][] = [
  ["Asia/Dubai", "UAE (Dubai)"],
  ["Asia/Karachi", "Pakistan (Karachi)"],
  ["Asia/Riyadh", "Saudi Arabia (Riyadh)"],
  ["Asia/Qatar", "Qatar"],
  ["Europe/London", "UK (London)"],
  ["Europe/Berlin", "Central Europe (Berlin, Paris)"],
  ["America/New_York", "USA Eastern (New York)"],
  ["America/Chicago", "USA Central (Chicago)"],
  ["America/Denver", "USA Mountain (Denver)"],
  ["America/Los_Angeles", "USA Pacific (Los Angeles)"],
  ["America/Toronto", "Canada Eastern (Toronto)"],
  ["Australia/Sydney", "Australia (Sydney)"],
  ["Asia/Kolkata", "India"],
  ["Asia/Singapore", "Singapore"],
];

function zoneOk(z?: string | null) {
  if (!z) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: z }); return true; } catch { return false; }
}
