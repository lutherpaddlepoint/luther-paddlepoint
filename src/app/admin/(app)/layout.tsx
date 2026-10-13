import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { requireUser } from "@/lib/auth";
import { attentionCounts } from "@/lib/admin-data";
import AdminNav from "@/components/admin/AdminNav";
import { logoutAction } from "../actions";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = await attentionCounts();
  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-brand text-white">
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <div className="flex items-center justify-between gap-3">
            <Link href="/admin" className="flex items-center gap-2 font-display text-lg font-semibold" aria-label="Luther PaddlePoint & Pool dashboard">
              <Image src="/logo-white.png" alt="" width={987} height={274} priority className="h-12 w-auto" />
              <span className="hidden sm:inline">&amp; Pool</span>
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <Link href="/admin/account" className="underline-offset-2 hover:underline">
                {user.name} ({user.role === "OWNER" ? "owner" : "staff"})
              </Link>
              <form action={logoutAction}>
                <button className="rounded-lg border border-white/40 px-2 py-1">Log out</button>
              </form>
            </div>
          </div>
          <div className="mt-2 pb-2">
            <AdminNav isOwner={user.role === "OWNER"} pending={counts.pendingPayments} attention={counts.attention} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
