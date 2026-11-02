import type { Client } from "@prisma/client";
import { Field } from "./ui";

/** Shared create/edit form for a client's profile. Lists are one per line. */
export function ClientForm({ client, action, submitLabel, showStatus }: { client?: Client; action: (fd: FormData) => Promise<void>; submitLabel: string; showStatus?: boolean }) {
  const lines = (a?: string[]) => (a ?? []).join("\n");
  return (
    <form action={action} className="space-y-8">
      <section className="card grid gap-4 md:grid-cols-2">
        <h3 className="font-semibold md:col-span-2">Basic info</h3>
        <Field label="Client / business name"><input className="input" name="name" required defaultValue={client?.name} /></Field>
        <Field label="Website URL"><input className="input" name="siteUrl" type="url" required defaultValue={client?.siteUrl} /></Field>
        <Field label="Business type"><input className="input" name="businessType" defaultValue={client?.businessType ?? ""} placeholder="Local service business" /></Field>
        <Field label="Target country"><input className="input" name="targetCountry" defaultValue={client?.targetCountry ?? ""} /></Field>
        <Field label="Primary city"><input className="input" name="primaryCity" defaultValue={client?.primaryCity ?? ""} /></Field>
        <Field label="Service area cities" hint="One per line"><textarea className="input" rows={3} name="serviceAreaCities" defaultValue={lines(client?.serviceAreaCities)} /></Field>
        <Field label="Services offered" hint="One per line"><textarea className="input" rows={4} name="servicesOffered" defaultValue={lines(client?.servicesOffered)} /></Field>
        <Field label="Competitors" hint="Names or URLs, one per line"><textarea className="input" rows={4} name="competitors" defaultValue={lines(client?.competitors)} /></Field>
        <div className="md:col-span-2"><Field label="Target audience"><textarea className="input" rows={3} name="targetAudience" defaultValue={client?.targetAudience ?? ""} /></Field></div>
        {showStatus && (
          <Field label="Status">
            <select className="input" name="status" defaultValue={client?.status}>
              <option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="ARCHIVED">Archived</option>
            </select>
          </Field>
        )}
      </section>

      <section className="card grid gap-4 md:grid-cols-2">
        <h3 className="font-semibold md:col-span-2">Brand voice and CTA</h3>
        <div className="md:col-span-2"><Field label="Words, topics or claims to avoid"><textarea className="input" rows={3} name="brandVoiceAvoid" defaultValue={client?.brandVoiceAvoid ?? ""} /></Field></div>
        <Field label="Primary CTA text"><input className="input" name="ctaText" defaultValue={client?.ctaText ?? ""} /></Field>
        <Field label="Primary CTA link"><input className="input" name="ctaLink" defaultValue={client?.ctaLink ?? ""} /></Field>
        <Field label="Primary color"><input className="input" name="brandPrimaryColor" defaultValue={client?.brandPrimaryColor ?? ""} placeholder="#1e40af" /></Field>
        <Field label="Secondary color"><input className="input" name="brandSecondaryColor" defaultValue={client?.brandSecondaryColor ?? ""} /></Field>
        <Field label="Accent color"><input className="input" name="brandAccentColor" defaultValue={client?.brandAccentColor ?? ""} /></Field>
        <Field label="Logo URL"><input className="input" name="logoUrl" defaultValue={client?.logoUrl ?? ""} /></Field>
      </section>

      <section className="card grid gap-4 md:grid-cols-2">
        <h3 className="font-semibold md:col-span-2">Publishing</h3>
        <Field label="Posts per month"><input className="input" name="postsPerMonth" type="number" min={0} defaultValue={client?.postsPerMonth ?? 4} /></Field>
        <Field label="Preferred posting dates" hint="YYYY-MM-DD, one per line. Leave empty to spread posts evenly."><textarea className="input" rows={3} name="preferredDates" defaultValue={lines(client?.preferredDates)} /></Field>
        <Field label="CMS platform"><input className="input" name="cmsPlatform" defaultValue={client?.cmsPlatform ?? "WordPress"} /></Field>
        <Field label="Master template post URL"><input className="input" name="masterTemplateUrl" defaultValue={client?.masterTemplateUrl ?? ""} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="imageRequired" defaultChecked={client?.imageRequired ?? false} /> Generate images</label>
        <Field label="Image style"><input className="input" name="imageStyle" defaultValue={client?.imageStyle ?? ""} /></Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="autoApproveKeywords" defaultChecked={client?.autoApproveKeywords ?? true} /> Auto-approve keywords from the Tally form</label>
      </section>

      <section className="card grid gap-4 md:grid-cols-2">
        <h3 className="font-semibold md:col-span-2">SEO</h3>
        <Field label="Link pool" hint="Internal pages for automatic linking, one per line"><textarea className="input" rows={5} name="linkPool" defaultValue={lines(client?.linkPool)} /></Field>
        <Field label="Social / external profile links" hint="One per line"><textarea className="input" rows={5} name="socialLinks" defaultValue={lines(client?.socialLinks)} /></Field>
        <Field label="GSC account"><input className="input" name="gscAccount" defaultValue={client?.gscAccount ?? ""} /></Field>
      </section>

      <button className="btn-primary">{submitLabel}</button>
    </form>
  );
}
