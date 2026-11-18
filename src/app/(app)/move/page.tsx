import { requireSuperAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { EnvBox } from "./env-box";

// One-time helper for the move from Vercel to the Hostinger VPS (Hamza approved it on 2026-11-18):
// Vercel hides saved values, so the running app shows them to the Super Admin as a ready .env file.
// Delete this folder once the VPS is live.
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const KEYS = [
  "DATABASE_URL", "DIRECT_URL", "ENCRYPTION_KEY", "ENCRYPTION_KEY_VERSION", "N8N_API_TOKEN", "N8N_WF1_WEBHOOK_URL", "N8N_WF2_WEBHOOK_URL",
  "TALLY_ONBOARDING_SIGNING_SECRET", "TALLY_KEYWORDS_SIGNING_SECRET", "TALLY_KEYWORDS_FORM_URL",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "PAGESPEED_API_KEY",
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_WRITER_MODEL", "GEMINI_SOCIAL_MODEL", "GEMINI_IMAGE_MODEL",
  "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "DATAFORSEO_DEFAULT_COUNTRY", "DATAFORSEO_AUDIT_MAX_PAGES",
  "GMAIL_USER", "GMAIL_APP_PASSWORD", "RESEND_API_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "REPORT_FROM_EMAIL", "REPORT_AGENCY_NAME",
  "META_ACCESS_TOKEN", "META_GRAPH_VERSION",
];

export default async function MovePage() {
  await requireSuperAdmin();
  if (!process.env.VERCEL) {
    return <PageHeader title="Settings for the VPS" subtitle="This page only works on the old Vercel address." />;
  }
  const lines = [
    "APP_URL=https://rankflow.digitaloasisus.com",
    "AUTH_TRUST_HOST=true",
    "N8N_ALLOWED_IPS=",
    ...KEYS.filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]!.replace(/\r?\n/g, "\\n")}`),
  ];
  return (
    <>
      <PageHeader title="Settings for the VPS" subtitle="Your saved settings, ready for /opt/rankflow/.env. They are secret: never paste them in a chat. This page is removed after the move." />
      <EnvBox text={lines.join("\n") + "\n"} />
    </>
  );
}
