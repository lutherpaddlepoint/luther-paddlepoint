import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { requireUser } from "@/lib/auth";
import { attentionCounts } from "@/lib/admin-data";
import AdminNav from "@/components/admin/AdminNav";
import { logoutAction } from "../actions";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Computers: pink menu down the left side, page on the right.
// Phones: logo bar on top with the menu as a sideways-scrolling row.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = await attentionCounts();
  const isOwner = user.role === "OWNER";
  const who = `${user.name} (${isOwner ? "owner" : "staff"})`;

  return (
    <div className="min-h-screen bg-paper md:flex">
      {/* Left sidebar (computers) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-brand text-white md:flex">
        <Link href="/admin" className="block px-5 pb-2 pt-3" aria-label="Luther PaddlePoint & Pool dashboard">
          <Image src="/logo-white.png" alt="" width={987} height={274} priority className="h-12 w-auto" />
          <span className="mt-1 block font-display text-sm font-semibold text-white/90">&amp; Pool</span>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <AdminNav vertical isOwner={isOwner} pending={counts.pendingPayments} attention={counts.attention} />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/20 px-4 py-2.5 text-sm">
          <Link href="/admin/account" className="min-w-0 truncate underline-offset-2 hover:underline" title={who}>{who}</Link>
          <form action={logoutAction} className="shrink-0">
            <button className="rounded-lg border border-white/40 px-2.5 py-1 font-semibold hover:bg-white/10">Log out</button>
          </form>
        </div>
      </aside>

      {/* Top bar (phones) */}
      <header className="bg-brand text-white md:hidden">
        <div className="px-4 pt-3">
          <div className="flex items-center justify-between gap-3">
            <Link href="/admin" className="flex items-center gap-2 font-display text-lg font-semibold" aria-label="Luther PaddlePoint & Pool dashboard">
              <Image src="/logo-white.png" alt="" width={987} height={274} priority className="h-12 w-auto" />
              <span className="hidden sm:inline">&amp; Pool</span>
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <Link href="/admin/account" className="underline-offset-2 hover:underline">{who}</Link>
              <form action={logoutAction}>
                <button className="rounded-lg border border-white/40 px-2 py-1">Log out</button>
              </form>
            </div>
          </div>
          <div className="mt-2 pb-2">
            <AdminNav isOwner={isOwner} pending={counts.pendingPayments} attention={counts.attention} />
          </div>
        </div>
      </header>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
