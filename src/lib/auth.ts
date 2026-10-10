// Staff and owner login. Every admin page, server action and admin API route calls
// requireUser() / getCurrentUser(), which re-checks the account on each request.
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";
import { passwordVersion, signSession, verifySession } from "./session-core";

const COOKIE = "lpp_session";
const TTL_MS = 12 * 60 * 60 * 1000; // one work shift
let dummyHash: string | null = null; // compared when the email doesn't exist, so timing doesn't reveal valid emails
const getDummyHash = async () => (dummyHash ??= await bcrypt.hash("no-such-user", 12));

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (at least 32 characters).");
  return s;
}

export type SessionUser = Pick<User, "id" | "name" | "email" | "role">;

export async function verifyLogin(email: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
  return user && user.isActive && ok ? user : null;
}

export function startSession(user: User) {
  const token = signSession(
    { uid: user.id, role: user.role, exp: Date.now() + TTL_MS, pv: passwordVersion(user.passwordHash, secret()) },
    secret(),
  );
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export function endSession() {
  cookies().delete(COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const payload = verifySession(cookies().get(COOKIE)?.value, secret());
  if (!payload) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user || !user.isActive || passwordVersion(user.passwordHash, secret()) !== payload.pv) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/** Use in admin pages and actions. Sends people without access to the login page. */
export async function requireUser(roles: Role[] = ["OWNER", "STAFF"]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  if (!roles.includes(user.role)) redirect("/admin?denied=1");
  return user;
}

export { hashPassword } from "./passwords";
