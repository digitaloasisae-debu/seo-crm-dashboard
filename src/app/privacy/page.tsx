export const metadata = { title: "Privacy policy · SEO Control Center" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl p-6 text-sm leading-6 text-slate-700">
      <h1 className="mb-2 text-xl font-semibold text-slate-900">Privacy policy</h1>
      <p className="mb-4 text-slate-500">Last updated 3 November 2026</p>
      <p className="mb-3">
        SEO Control Center is a private internal tool used by Digital Oasis and its team to manage SEO and content work for
        their clients. It is not offered to the public.
      </p>
      <h2 className="mt-5 mb-1 font-semibold text-slate-900">Google data</h2>
      <p className="mb-3">
        When a team member connects a Google account, the app requests read-only access to Google Search Console
        (webmasters.readonly) and the account&apos;s email address. It reads search performance data (clicks, impressions,
        click-through rate, average position, queries and pages) for websites managed for clients, and shows it to the
        team inside the app. The app does not modify Search Console data.
      </p>
      <p className="mb-3">
        Google data is stored in the app&apos;s database only to display reports, is not sold, is not shared with third
        parties, and is not used for advertising. Sign-in tokens are stored encrypted. Use of information received from
        Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.
      </p>
      <h2 className="mt-5 mb-1 font-semibold text-slate-900">Removing access</h2>
      <p className="mb-3">
        A Google account can be disconnected from the app&apos;s Google page at any time, which deletes its stored token.
        Access can also be revoked at myaccount.google.com/permissions.
      </p>
      <h2 className="mt-5 mb-1 font-semibold text-slate-900">Contact</h2>
      <p>digitaloasis.sem@gmail.com</p>
    </main>
  );
}
