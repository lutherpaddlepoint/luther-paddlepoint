"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; badge?: number; ownerOnly?: boolean };

export default function AdminNav({ isOwner, pending, attention }: { isOwner: boolean; pending: number; attention: number }) {
  const path = usePathname();
  const items: Item[] = [
    { href: "/admin", label: "Today" },
    { href: "/admin/payments", label: "Payments", badge: pending + attention },
    { href: "/admin/calendar", label: "Calendar" },
    { href: "/admin/check-in", label: "Check-in" },
    { href: "/admin/walk-in", label: "Walk-in" },
    { href: "/admin/open-play", label: "Open play" },
    { href: "/admin/blocks", label: "Blocks", ownerOnly: true },
    { href: "/admin/reports", label: "Reports", ownerOnly: true },
    { href: "/admin/settings", label: "Settings", ownerOnly: true },
  ];
  return (
    <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4" aria-label="Dashboard">
      {items
        .filter((i) => isOwner || !i.ownerOnly)
        .map((i) => {
          const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold ${
                active ? "bg-white text-court" : "text-white/85 hover:bg-white/10"
              }`}
            >
              {i.label}
              {!!i.badge && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ball px-1 text-xs text-ink">{i.badge}</span>
              )}
            </Link>
          );
        })}
    </nav>
  );
}
