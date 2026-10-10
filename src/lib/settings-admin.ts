// Owner-only changes to rates, hours and accounts. Price changes apply to NEW bookings;
// existing bookings keep the price they were booked at.
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { AdminError } from "./admin-ops";
import { hashPassword, checkPassword } from "./passwords";
import type { SessionUser } from "./auth";
import { todayInManila } from "./time";
import type { AppSettings } from "./defaults";

const log = (tx: Prisma.TransactionClient, user: SessionUser, action: string, details: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { action, entity: "settings", userId: user.id, details } });

const setSetting = (tx: Prisma.TransactionClient, key: keyof AppSettings, value: unknown) =>
  tx.setting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });

export type RatesInput = {
  openMinute: number;
  closeMinute: number;
  nightStartMinute: number;
  courtDayCentavos: number;
  courtNightCentavos: number;
  poolAdultCentavos: number;
  poolKidCentavos: number;
  poolCapacity: number;
};

export async function getRatesForm(): Promise<RatesInput> {
  const s = await getSettings();
  const [court, pool] = await Promise.all([
    prisma.amenity.findFirst({ where: { type: "COURT", isActive: true }, include: { rateRules: { where: { isActive: true, unit: "PER_HOUR" }, orderBy: { startMinute: "asc" } } } }),
    prisma.amenity.findFirst({ where: { type: "POOL", isActive: true }, include: { rateRules: { where: { isActive: true, unit: "PER_PERSON" } } } }),
  ]);
  return {
    openMinute: s.operating_hours.openMinute,
    closeMinute: s.operating_hours.closeMinute,
    nightStartMinute: s.lights_on_minute,
    courtDayCentavos: court?.rateRules[0]?.priceCentavos ?? 0,
    courtNightCentavos: court?.rateRules.at(-1)?.priceCentavos ?? 0,
    poolAdultCentavos: pool?.rateRules.find((r) => r.guestType === "ADULT")?.priceCentavos ?? 0,
    poolKidCentavos: pool?.rateRules.find((r) => r.guestType === "KID")?.priceCentavos ?? 0,
    poolCapacity: pool?.capacity ?? 30,
  };
}

/**
 * Saves hours and prices. The court gets exactly two rules (day: open→night start,
 * night: night start→close); pool sessions follow the same split.
 */
export async function saveRates(r: RatesInput, user: SessionUser) {
  const ints = Object.values(r);
  if (ints.some((v) => !Number.isFinite(v) || v < 0)) throw new AdminError("Check the numbers: they can't be empty or negative.");
  if (!(r.openMinute < r.nightStartMinute && r.nightStartMinute < r.closeMinute))
    throw new AdminError("Night rate must start after opening time and before closing time.");
  if (r.openMinute % 60 || r.closeMinute % 60 || r.nightStartMinute % 60) throw new AdminError("Times must be on the hour.");
  if (r.poolCapacity < 1 || r.poolCapacity > 500) throw new AdminError("Pool capacity must be between 1 and 500.");
  if (r.courtDayCentavos < 100 || r.courtNightCentavos < 100 || r.poolAdultCentavos < 100)
    throw new AdminError("Prices must be at least ₱1.");

  const [court, pool] = await Promise.all([
    prisma.amenity.findFirst({ where: { type: "COURT", isActive: true } }),
    prisma.amenity.findFirst({ where: { type: "POOL", isActive: true }, include: { poolSessions: { orderBy: { startMinute: "asc" } } } }),
  ]);
  const before = await getRatesForm();

  try {
    await prisma.$transaction(async (tx) => {
      if (court) {
        await tx.rateRule.updateMany({ where: { amenityId: court.id, unit: "PER_HOUR" }, data: { isActive: false } });
        await tx.rateRule.createMany({
          data: [
            { amenityId: court.id, label: "Day rate", startMinute: r.openMinute, endMinute: r.nightStartMinute, priceCentavos: r.courtDayCentavos, unit: "PER_HOUR" },
            { amenityId: court.id, label: "Night rate", startMinute: r.nightStartMinute, endMinute: r.closeMinute, priceCentavos: r.courtNightCentavos, unit: "PER_HOUR" },
          ],
        });
      }
      if (pool) {
        await tx.rateRule.updateMany({ where: { amenityId: pool.id, unit: "PER_PERSON" }, data: { isActive: false } });
        await tx.rateRule.createMany({
          data: [
            { amenityId: pool.id, label: "Adult entrance", startMinute: r.openMinute, endMinute: r.closeMinute, priceCentavos: r.poolAdultCentavos, unit: "PER_PERSON", guestType: "ADULT" },
            { amenityId: pool.id, label: "Kid entrance (10 & below)", startMinute: r.openMinute, endMinute: r.closeMinute, priceCentavos: r.poolKidCentavos, unit: "PER_PERSON", guestType: "KID" },
          ],
        });
        const [day, night] = pool.poolSessions;
        if (day) await tx.poolSession.update({ where: { id: day.id }, data: { startMinute: r.openMinute, endMinute: r.nightStartMinute } });
        if (night) await tx.poolSession.update({ where: { id: night.id }, data: { startMinute: r.nightStartMinute, endMinute: r.closeMinute } });
        await tx.amenity.update({ where: { id: pool.id }, data: { capacity: r.poolCapacity } });
        // Upcoming dates take the new capacity. The database refuses if a date already has more guests.
        await tx.poolSessionInventory.updateMany({
          where: { date: { gte: new Date(`${todayInManila()}T00:00:00Z`) }, poolSession: { amenityId: pool.id } },
          data: { capacity: r.poolCapacity },
        });
      }
      await setSetting(tx, "operating_hours", { openMinute: r.openMinute, closeMinute: r.closeMinute });
      await setSetting(tx, "lights_on_minute", r.nightStartMinute);
      await log(tx, user, "RATES_UPDATED", { before, after: r } as unknown as Prisma.InputJsonValue);
    });
  } catch (e) {
    if (String((e as Error).message).includes("pool_inventory_capacity_check"))
      throw new AdminError("Some upcoming dates already have more pool guests than the new capacity. Use a higher number.");
    throw e;
  }
}

export type GeneralInput = {
  reservationFeePercent: number;
  holdMinutesManual: number;
  bookingWindowDays: number;
  rescheduleMinHours: number;
  paymentMode: "GCASH_MANUAL" | "GCASH_PAYMONGO";
  gcashName: string;
  gcashNumber: string;
  gcashQrPath: string;
  policyText: string;
  contactInfo: string;
  staffEmails: string[];
  smsEvents: string[];
};

export async function saveGeneral(g: GeneralInput, user: SessionUser) {
  if (g.reservationFeePercent < 1 || g.reservationFeePercent > 100) throw new AdminError("Reservation fee must be 1–100%.");
  if (g.holdMinutesManual < 10 || g.holdMinutesManual > 180) throw new AdminError("Hold time must be 10–180 minutes.");
  if (g.bookingWindowDays < 1 || g.bookingWindowDays > 365) throw new AdminError("Booking window must be 1–365 days.");
  if (g.rescheduleMinHours < 0 || g.rescheduleMinHours > 168) throw new AdminError("Reschedule notice must be 0–168 hours.");
  if (g.paymentMode === "GCASH_PAYMONGO" && (!process.env.PAYMONGO_SECRET_KEY || !process.env.PAYMONGO_WEBHOOK_SECRET))
    throw new AdminError("PayMongo keys aren't set up on the server yet. Keep manual GCash for now.");
  if (g.gcashQrPath && !/^\/[\w\-./]+\.(png|jpg|jpeg|webp)$/i.test(g.gcashQrPath)) throw new AdminError('QR image path should look like "/gcash-qr.png".');
  const badEmail = g.staffEmails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (badEmail) throw new AdminError(`"${badEmail}" isn't a valid email.`);
  if (g.contactInfo.trim().length < 5) throw new AdminError("Add contact details customers can use (mobile or Facebook page).");

  const s = await getSettings();
  await prisma.$transaction(async (tx) => {
    await setSetting(tx, "reservation_fee_percent", g.reservationFeePercent);
    await setSetting(tx, "hold_minutes", { ...s.hold_minutes, GCASH_MANUAL: g.holdMinutesManual });
    await setSetting(tx, "booking_window_days", g.bookingWindowDays);
    await setSetting(tx, "reschedule_policy", { ...s.reschedule_policy, minHoursBefore: g.rescheduleMinHours });
    await setSetting(tx, "payment_mode", g.paymentMode);
    await setSetting(tx, "gcash_account", { name: g.gcashName.trim(), number: g.gcashNumber.trim(), qrImagePath: g.gcashQrPath.trim() || null });
    await setSetting(tx, "policy_text", g.policyText.trim());
    await setSetting(tx, "contact_info", g.contactInfo.trim());
    await setSetting(tx, "notifications", { smsEvents: g.smsEvents, staffEmails: g.staffEmails });
    await log(tx, user, "SETTINGS_UPDATED", { ...g } as unknown as Prisma.InputJsonValue);
  });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
const tempPassword = () => randomBytes(6).toString("base64url"); // 8 characters

export async function addStaff(name: string, email: string, user: SessionUser) {
  if (name.trim().length < 2) throw new AdminError("Enter the staff member's name.");
  if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) throw new AdminError("Enter an email (used to log in).");
  const pw = tempPassword();
  try {
    await prisma.user.create({ data: { name: name.trim(), email: email.trim().toLowerCase(), role: "STAFF", passwordHash: await hashPassword(pw) } });
  } catch {
    throw new AdminError("That email is already used by another account.");
  }
  await prisma.auditLog.create({ data: { action: "STAFF_ADDED", entity: "user", userId: user.id, details: { email } } });
  return pw;
}

export async function resetPassword(userId: string, user: SessionUser) {
  if (userId === user.id) throw new AdminError("Use “My account” to change your own password.");
  const pw = tempPassword();
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(pw) } }); // also logs them out
  await prisma.auditLog.create({ data: { action: "PASSWORD_RESET", entity: "user", entityId: userId, userId: user.id } });
  return pw;
}

export async function setActive(userId: string, active: boolean, user: SessionUser) {
  if (userId === user.id) throw new AdminError("You can't deactivate your own account.");
  await prisma.user.update({ where: { id: userId }, data: { isActive: active } });
  await prisma.auditLog.create({ data: { action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED", entity: "user", entityId: userId, userId: user.id } });
}

export async function changeOwnPassword(userId: string, current: string, next: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await checkPassword(current, u.passwordHash))) throw new AdminError("Your current password is wrong.");
  if (next.length < 8) throw new AdminError("Use at least 8 characters for the new password.");
  if (next === current) throw new AdminError("Choose a different password.");
  const updated = await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await prisma.auditLog.create({ data: { action: "PASSWORD_CHANGED", entity: "user", entityId: userId, userId } });
  return updated;
}
