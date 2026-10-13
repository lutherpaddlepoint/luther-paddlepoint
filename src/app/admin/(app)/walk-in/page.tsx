import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { rulesOf } from "@/lib/bookings";
import { todayInManila, utcToManila } from "@/lib/time";
import WalkInForm from "@/components/admin/WalkInForm";
import { walkInAction } from "@/app/admin/actions";

export default async function WalkInPage() {
  await requireUser();
  const settings = await getSettings();
  const [courtList, pool] = await Promise.all([
    prisma.amenity.findMany({ where: { type: "COURT", isActive: true }, orderBy: { name: "asc" } }),
    prisma.amenity.findFirst({ where: { type: "POOL", isActive: true }, include: { poolSessions: { where: { isActive: true }, orderBy: { startMinute: "asc" } } } }),
  ]);
  const now = utcToManila(new Date());
  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold">Walk-in or phone booking</h1>
      <p className="mt-1 mb-6 max-w-xl text-muted">The slot is blocked immediately, the same as an online booking. The price is calculated with the current rates.</p>
      <WalkInForm
        action={walkInAction}
        today={todayInManila()}
        nowHour={Math.floor(now.minuteOfDay / 60) * 60}
        openMinute={settings.operating_hours.openMinute}
        closeMinute={settings.operating_hours.closeMinute}
        feePercent={settings.reservation_fee_percent}
        courts={await Promise.all(courtList.map(async (c) => ({ id: c.id, name: c.name, rules: await rulesOf(c.id) })))}
        poolRules={pool ? await rulesOf(pool.id) : []}
        sessions={(pool?.poolSessions ?? []).map(({ id, name, startMinute, endMinute }) => ({ id, name, startMinute, endMinute }))}
      />
    </div>
  );
}
