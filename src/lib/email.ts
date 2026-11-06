/** Sends email through Resend (https://resend.com) with plain fetch. Needs RESEND_API_KEY and REPORT_FROM_EMAIL. */
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(opts: { to: string[]; subject: string; html: string; text: string; replyTo?: string; attachments?: { filename: string; content: Buffer }[] }) {
  if (!process.env.RESEND_API_KEY) throw new Error("Email isn't set up yet: add RESEND_API_KEY in Vercel");
  const from = process.env.REPORT_FROM_EMAIL || "Rankflow Reports <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      attachments: (opts.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = String(j.message ?? j.error ?? res.status);
    if (/verify a domain|testing emails|own email address/i.test(m)) throw new Error(`${m} (verify your domain in Resend → Domains, then set REPORT_FROM_EMAIL to an address on it)`);
    throw new Error(`Email failed: ${m}`);
  }
  return j as { id: string };
}
