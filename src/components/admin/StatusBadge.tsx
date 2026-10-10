const STYLES: Record<string, [string, string]> = {
  HOLD: ["Unpaid hold", "bg-ball/40 text-ink"],
  PENDING_VERIFICATION: ["Check payment", "bg-dusk text-white"],
  CONFIRMED: ["Confirmed", "bg-court text-white"],
  CHECKED_IN: ["Checked in", "bg-pool text-white"],
  COMPLETED: ["Completed", "bg-line text-ink"],
  NO_SHOW: ["No-show", "bg-red-100 text-red-800"],
  CANCELLED: ["Cancelled", "bg-line text-muted"],
  EXPIRED: ["Expired", "bg-line text-muted"],
  REJECTED: ["Payment rejected", "bg-red-100 text-red-800"],
};

export default function StatusBadge({ status, kind }: { status: string; kind?: string }) {
  if (kind === "BLOCK") return <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-white">Blocked</span>;
  const [label, cls] = STYLES[status] ?? [status, "bg-line"];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>{label}</span>;
}
