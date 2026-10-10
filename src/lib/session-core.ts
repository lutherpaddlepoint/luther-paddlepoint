// Signed session cookies (pure, testable). The cookie holds only the user id, role,
// expiry and a "password version", signed with SESSION_SECRET so it can't be forged.
// Changing a password changes the version, which logs out every old session.
import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionPayload = { uid: string; role: "OWNER" | "STAFF"; exp: number; pv: string };

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function signSession(p: SessionPayload, secret: string): string {
  const body = b64url(JSON.stringify(p));
  return `${body}.${sign(body, secret)}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof p.exp !== "number" || p.exp < now) return null;
    if (p.role !== "OWNER" && p.role !== "STAFF") return null;
    return p;
  } catch {
    return null;
  }
}

export const passwordVersion = (passwordHash: string, secret: string) =>
  createHmac("sha256", secret).update(passwordHash).digest("base64url").slice(0, 16);
