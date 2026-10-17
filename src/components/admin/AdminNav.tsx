"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; badge?: number; ownerOnly?: boolean };

/**
 * Dashboard menu. `vertical` = the left sidebar on computers (one item per line);
 * otherwise a row of tabs that scrolls sideways (phones).
 */
export default function AdminNav({
  isOwner, pending, attention, vertical = false,
}: { isOwner: boolean; pending: number; attention: number; vertical?: boolean }) {
  const path = usePathname();
  const items: Item[] = [
    { href: "/admin", label: "Today" },
    { href: "/admin/payments", label: "Payments", badge: pending + attention },
    { href: "/admin/calendar", label: "Calendar" },
    { href: "/admin/check-in", label: "Check-in" },
    { href: "/admin/walk-in", label: "Walk-in" },
    { href: "/admin/open-play", label: "Open play" },
    { href: "/admin/scoreboard", label: "Scoreboard" },
    { href: "/admin/blocks", label: "Blocks", ownerOnly: true },
    { href: "/admin/reports", label: "Reports", ownerOnly: true },
    { href: "/admin/settings", label: "Settings", ownerOnly: true },
  ];
  return (
    <nav
      className={vertical ? "flex flex-col gap-0.5" : "no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4"}
      aria-label={vertical ? "Dashboard menu" : "Dashboard"}
    >
      {items
        .filter((i) => isOwner || !i.ownerOnly)
        .map((i) => {
          const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
          const look = active ? "bg-white text-brand shadow-sm" : "text-white/90 hover:bg-white/10";
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={
                vertical
                  ? `flex items-center justify-between gap-2 rounded-xl px-4 py-1.5 text-[15px] font-bold uppercase leading-6 tracking-wide ${look}`
                  : `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold ${look}`
              }
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
