// The actual email and SMS delivery. Both report "not configured" instead of failing when
// their settings are missing, so the app works in development without sending anything.
import nodemailer, { type Transporter } from "nodemailer";

export class NotConfigured extends Error {}

let transport: Transporter | null = null;

/**
 * Sends through a Google Apps Script web app (scripts/gmail-relay.gs) over HTTPS.
 * Used on hosts that block outgoing SMTP, such as Render's free plan.
 */
async function sendViaRelay(url: string, secret: string, to: string, msg: { subject: string; text: string; html: string }, qrPng?: Buffer) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script reads the raw body
    body: JSON.stringify({ secret, to, subject: msg.subject, text: msg.text, html: msg.html, qrBase64: qrPng?.toString("base64") ?? null }),
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.text();
  let parsed: { ok?: boolean; error?: string } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Google returned an HTML page (wrong URL, or the script isn't deployed for "Anyone")
  }
  if (!res.ok || !parsed) throw new Error(`Email relay failed (${res.status}). Check MAIL_RELAY_URL and that the script is deployed with access "Anyone".`);
  if (!parsed.ok) throw new Error(`Email relay: ${parsed.error ?? "unknown error"}`);
}

export async function sendEmail(to: string, msg: { subject: string; text: string; html: string }, qrPng?: Buffer) {
  const { MAIL_RELAY_URL, MAIL_RELAY_SECRET } = process.env;
  if (MAIL_RELAY_URL && MAIL_RELAY_SECRET) return sendViaRelay(MAIL_RELAY_URL, MAIL_RELAY_SECRET, to, msg, qrPng);
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new NotConfigured("Email is not set up (SMTP_* settings).");
  transport ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 465),
    secure: Number(SMTP_PORT || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
  await transport.sendMail({
    from: EMAIL_FROM || SMTP_USER,
    to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    attachments: qrPng ? [{ filename: "booking-qr.png", content: qrPng, cid: "qr", contentType: "image/png" }] : [],
  });
}

/** Semaphore (semaphore.co), a Philippine SMS provider. Numbers in 09XXXXXXXXX format. */
export async function sendSms(to: string, message: string) {
  const key = process.env.SEMAPHORE_API_KEY;
  if (!key) throw new NotConfigured("SMS is not set up (SEMAPHORE_API_KEY).");
  const body = new URLSearchParams({ apikey: key, number: to, message });
  if (process.env.SEMAPHORE_SENDER_NAME) body.set("sendername", process.env.SEMAPHORE_SENDER_NAME);
  const res = await fetch("https://api.semaphore.co/api/v4/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SMS failed (${res.status}): ${text.slice(0, 200)}`);
  // Semaphore returns 200 with an error object for some problems (e.g. invalid number, no credits)
  if (/"(number|message|apikey|sendername)"\s*:\s*\[/.test(text) || /insufficient|credit/i.test(text))
    throw new Error(`SMS rejected: ${text.slice(0, 200)}`);
}

export const smsConfigured = () => !!process.env.SEMAPHORE_API_KEY;
