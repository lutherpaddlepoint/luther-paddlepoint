import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import { loginAction } from "../../actions";

export const metadata: Metadata = { title: "Staff login", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/admin");
  return (
    <main className="mx-auto max-w-sm px-5 py-16">
      <h1 className="font-display text-3xl font-extrabold text-court">Staff login</h1>
      <p className="mt-2 text-muted">Luther PaddlePoint &amp; Pool</p>
      <ActionForm action={loginAction} submitLabel="Log in" pendingLabel="Logging in…" full className="mt-8 grid gap-4">
        <label className={labelCls}>
          Email
          <input name="email" type="email" autoComplete="username" required className={inputCls} />
        </label>
        <label className={labelCls}>
          Password
          <input name="password" type="password" autoComplete="current-password" required className={inputCls} />
        </label>
      </ActionForm>
      <p className="mt-6 text-sm text-muted">Forgot your password? Ask the owner to reset it.</p>
    </main>
  );
}
