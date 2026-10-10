import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { csvCell } from "@/lib/admin-core";
import { formatMinute, manilaToUtc, utcToManila } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "OWNER") return new Response("Not allowed", { status: 403 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new Response("Invalid dates", { status: 400 });

  const bookings = await prisma.booking.findMany({
    where: { kind: "BOOKING", startAt: { gte: manilaToUtc(from, 0), lt: manilaToUtc(to, 1440) }, status: { notIn: ["HOLD", "EXPIRED"] } },
    orderBy: { startAt: "asc" },
    include: { amenity: true, payments: true },
  });

  const header = ["Reference", "Date", "Start", "End", "Amenity", "Customer", "Mobile", "Email", "Source", "Status",
    "Adults/Players", "Kids", "Total (PHP)", "Paid (PHP)", "Balance (PHP)", "Paid by", "GCash Ref. Nos."];
  const rows = bookings.map((b) => {
    const s = utcToManila(b.startAt);
    const e = utcToManila(b.endAt);
    const paidRows = b.payments.filter((p) => p.status === "PAID");
    const paid = paidRows.reduce((t, p) => t + p.amountCentavos, 0);
    return [
      b.referenceCode, s.date, formatMinute(s.minuteOfDay), formatMinute(e.minuteOfDay), b.amenity.name, b.customerName, b.mobile,
      b.email, b.source === "WALK_IN" ? "Walk-in" : "Online", b.status, b.adults, b.kids,
      (b.totalCentavos / 100).toFixed(2), (paid / 100).toFixed(2), (Math.max(0, b.totalCentavos - paid) / 100).toFixed(2),
      [...new Set(paidRows.map((p) => (p.method === "CASH" ? "Cash" : "GCash")))].join(" + "),
      paidRows.map((p) => p.gcashReference).filter(Boolean).join(" "),
    ];
  });

  await prisma.auditLog.create({ data: { action: "REPORT_EXPORTED", entity: "report", userId: user.id, details: { from, to, rows: rows.length } } });

  // BOM so Excel opens the file as UTF-8 (names with ñ display correctly)
  const csv = "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bookings_${from}_to_${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
