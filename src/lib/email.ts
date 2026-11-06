/**
 * Sends email. Two options:
 *  - Gmail (or any SMTP): GMAIL_USER + GMAIL_APP_PASSWORD (a Google "app password"), or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.
 *  - Resend: RESEND_API_KEY (+ REPORT_FROM_EMAIL on a verified domain).
 * Gmail/SMTP wins when both are set.
 */
import nodemailer from "nodemailer";

type Mail = { to: string[]; subject: string; html: string; text: string; replyTo?: string; attachments?: { filename: string; content: Buffer }[] };

function smtpConfig() {
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return { host: "smtp.gmail.com", port: 465, secure: true, user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") };
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 465;
    return { host: process.env.SMTP_HOST, port, secure: port === 465, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }
  return null;
}

export function emailConfigured() {
  return Boolean(smtpConfig() || process.env.RESEND_API_KEY);
}

export async function sendEmail(m: Mail) {
  const smtp = smtpConfig();
  if (smtp) return sendSmtp(m, smtp);
  if (process.env.RESEND_API_KEY) return sendResend(m);
  throw new Error("Email isn't set up yet: add GMAIL_USER and GMAIL_APP_PASSWORD in Vercel");
}

async function sendSmtp(m: Mail, c: NonNullable<ReturnType<typeof smtpConfig>>) {
  const name = process.env.REPORT_AGENCY_NAME || "Digital Oasis";
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15_000, socketTimeout: 30_000 });
  try {
    const info = await transport.sendMail({
      from: process.env.REPORT_FROM_EMAIL || `"${name}" <${c.user}>`,
      to: m.to.join(", "), subject: m.subject, html: m.html, text: m.text, replyTo: m.replyTo,
      attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content, contentType: "application/pdf" })),
    });
    return { id: info.messageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/535|Username and Password not accepted|BadCredentials|Invalid login/i.test(msg)) {
      if (c.host !== "smtp.gmail.com") throw new Error(`The mail server refused the login: ${msg}`);
      throw new Error("Gmail refused the login. GMAIL_APP_PASSWORD must be a 16-letter app password (myaccount.google.com/apppasswords), not your normal password, and GMAIL_USER must be that same Gmail address.");
    }
    throw new Error(`Email failed: ${msg}`);
  }
}

async function sendResend(m: Mail) {
  const from = process.env.REPORT_FROM_EMAIL || "Rankflow Reports <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: m.to, subject: m.subject, html: m.html, text: m.text,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email failed: ${String(j.message ?? j.error ?? res.status)}`);
  return j as { id: string };
}
