"use server";

// Every dashboard button goes through one of these. Each one checks who is logged in
// (and their role) on the server before doing anything.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { endSession, requireUser, startSession, verifyLogin } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { confirmPayment, rejectPayment, PaymentError } from "@/lib/payments";
import {
  AdminError, addNote, cancelBooking, checkIn, createCourtBlock, createWalkIn, markNoShow,
  recordBalance, rescheduleBooking, resolveAttention, setPoolClosed,
} from "@/lib/admin-ops";
import { addStaff, changeOwnPassword, resetPassword, saveGeneral, saveRates, setActive } from "@/lib/settings-admin";
import { prisma } from "@/lib/db";
import { abandonMatchAsStaff, newRefereeToken, ScoreError } from "@/lib/scoring";
import {
  addPlayer, cancelOpenPlay, checkOutPlayer, closeOpenPlay, createOpenPlay, finishGame, moveToBack, setResting, startNextGame,
} from "@/lib/open-play";
import { sendEmail, NotConfigured } from "@/lib/senders";
import { toMinute } from "@/lib/time";
import type { ActionResult } from "@/lib/action-result";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? NaN : Number.parseInt(v, 10);
};
const minute = (fd: FormData, k: string) => (/^\d{1,2}:\d{2}$/.test(str(fd, k)) ? toMinute(str(fd, k)) : NaN);
const centavos = (fd: FormData, k: string) => {
  const v = str(fd, k).replace(/[₱,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : NaN;
};

async function run(fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    const r = await fn();
    revalidatePath("/admin", "layout");
    return r ?? { ok: true };
  } catch (e) {
    // redirect() works by throwing; let it through.
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof AdminError || e instanceof PaymentError || e instanceof ScoreError) return { ok: false, error: e.message };
    console.error("Admin action failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// ---------------------------------------------------------------- login
export async function loginAction(fd: FormData): Promise<ActionResult> {
  const email = str(fd, "email").toLowerCase();
  const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`login:${ip}:${email}`, 5, 15 * 60_000))
    return { ok: false, error: "Too many attempts. Wait 15 minutes and try again." };
  const user = await verifyLogin(email, String(fd.get("password") ?? ""));
  if (!user) return { ok: false, error: "Wrong email or password." };
  startSession(user);
  await prisma.auditLog.create({ data: { action: "LOGIN", entity: "user", entityId: user.id, userId: user.id, details: { ip } } });
  return { ok: true, redirect: "/admin" };
}

export async function logoutAction() {
  endSession();
  redirect("/admin/login");
}

// ---------------------------------------------------------------- payments (staff + owner)
export async function approvePaymentAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const result = await confirmPayment(str(fd, "paymentId"), { userId: user.id, source: "STAFF" });
    const msg: Record<string, string> = {
      CONFIRMED: "Approved. Booking confirmed.",
      CONFIRMED_AFTER_EXPIRY: "Approved. The late booking was restored.",
      ALREADY_PAID: "This payment was already approved.",
      PAID_SLOT_TAKEN: "Approved, but the slot was already taken. The booking is flagged so you can contact the customer.",
      PAID_NEEDS_ATTENTION: "Approved and flagged for review.",
    };
    return { ok: true, message: msg[result] };
  });
}

export async function rejectPaymentAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const reason = str(fd, "reason") === "Other" ? str(fd, "otherReason") : str(fd, "reason");
    await rejectPayment(str(fd, "paymentId"), user.id, reason);
    return { ok: true, message: "Rejected. The slot was released." };
  });
}

// ---------------------------------------------------------------- bookings (staff + owner)
export async function walkInAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const amenity = str(fd, "amenity") === "POOL" ? "POOL" : "COURT";
    const b = await createWalkIn(
      {
        amenity,
        date: str(fd, "date"),
        startMinute: minute(fd, "start"),
        endMinute: minute(fd, "end"),
        players: int(fd, "players") || 2,
        sessionId: str(fd, "sessionId"),
        adults: int(fd, "adults") || 0,
        kids: int(fd, "kids") || 0,
        name: str(fd, "name"),
        mobile: str(fd, "mobile"),
        paid: (["FULL", "FEE", "NONE"].includes(str(fd, "paid")) ? str(fd, "paid") : "FULL") as "FULL" | "FEE" | "NONE",
        method: str(fd, "method") === "GCASH_MANUAL" ? "GCASH_MANUAL" : "CASH",
        gcashReference: str(fd, "gcashReference"),
        checkInNow: fd.get("checkInNow") === "on",
      },
      user,
    );
    return { ok: true, redirect: `/admin/bookings/${b.id}` };
  });
}

export async function checkInAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const collect = str(fd, "collect") as "CASH" | "GCASH_MANUAL" | "LATER";
    await checkIn(str(fd, "bookingId"), ["CASH", "GCASH_MANUAL", "LATER"].includes(collect) ? collect : "LATER", str(fd, "gcashReference"), user);
    return { ok: true, message: "Checked in." };
  });
}

export async function recordBalanceAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const method = str(fd, "method") === "GCASH_MANUAL" ? "GCASH_MANUAL" : "CASH";
    const amount = await recordBalance(str(fd, "bookingId"), method, str(fd, "gcashReference"), user);
    return { ok: true, message: amount ? "Balance recorded." : "Nothing left to pay." };
  });
}

export async function noShowAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await markNoShow(str(fd, "bookingId"), user);
    return { ok: true, message: "Marked as no-show." };
  });
}

export async function resolveAttentionAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await resolveAttention(str(fd, "bookingId"), str(fd, "note"), user);
    return { ok: true, message: "Marked as resolved." };
  });
}

export async function addNoteAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await addNote(str(fd, "bookingId"), str(fd, "note"), user);
    return { ok: true, message: "Note saved." };
  });
}

export async function findBookingAction(fd: FormData) {
  return run(async () => {
    await requireUser();
    const raw = str(fd, "code").toUpperCase().replace(/\s/g, "");
    const code = raw.startsWith("LPP-") ? raw : `LPP-${raw}`;
    const b = await prisma.booking.findUnique({ where: { referenceCode: code }, select: { id: true } });
    if (!b) return { ok: false, error: `No booking ${code}.` };
    return { ok: true, redirect: `/admin/bookings/${b.id}` };
  });
}

// ---------------------------------------------------------------- owner only
export async function cancelAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    await cancelBooking(str(fd, "bookingId"), str(fd, "reason"), user);
    return { ok: true, message: "Cancelled. The reservation fee is not refunded." };
  });
}

export async function rescheduleAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    await rescheduleBooking(
      str(fd, "bookingId"),
      {
        date: str(fd, "date"),
        startMinute: minute(fd, "start"),
        endMinute: minute(fd, "end"),
        sessionId: str(fd, "sessionId") || undefined,
        adults: Number.isNaN(int(fd, "adults")) ? undefined : int(fd, "adults"),
        kids: Number.isNaN(int(fd, "kids")) ? undefined : int(fd, "kids"),
        overridePolicy: fd.get("override") === "on",
      },
      user,
    );
    return { ok: true, message: "Rescheduled." };
  });
}

export async function blockAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    await createCourtBlock(str(fd, "date"), minute(fd, "start"), minute(fd, "end"), str(fd, "reason"), user);
    return { ok: true, message: "Court blocked." };
  });
}

export async function removeBlockAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    await cancelBooking(str(fd, "bookingId"), "Block removed", user);
    return { ok: true, message: "Block removed. The court is open again." };
  });
}

export async function poolClosureAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    const closed = str(fd, "closed") === "1";
    const affected = await setPoolClosed(str(fd, "sessionId"), str(fd, "date"), closed, str(fd, "reason"), user);
    if (!closed) return { ok: true, message: "Pool session reopened." };
    return {
      ok: true,
      message: affected.length
        ? `Closed. ${affected.length} booking(s) are on this session; contact them: ${affected.map((a) => `${a.referenceCode} ${a.customerName} ${a.mobile ?? ""}`).join("; ")}`
        : "Closed. No bookings were affected.",
    };
  });
}

export async function saveRatesAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    await saveRates(
      {
        openMinute: minute(fd, "open"), closeMinute: minute(fd, "close"), nightStartMinute: minute(fd, "nightStart"),
        courtDayCentavos: centavos(fd, "courtDay"), courtNightCentavos: centavos(fd, "courtNight"),
        poolAdultCentavos: centavos(fd, "poolAdult"), poolKidCentavos: centavos(fd, "poolKid"),
        poolCapacity: int(fd, "poolCapacity"),
      },
      user,
    );
    return { ok: true, message: "Rates and hours saved. They apply to new bookings." };
  });
}

export async function saveGeneralAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    await saveGeneral(
      {
        reservationFeePercent: int(fd, "feePercent"), holdMinutesManual: int(fd, "holdMinutes"),
        bookingWindowDays: int(fd, "windowDays"), rescheduleMinHours: int(fd, "rescheduleHours"),
        paymentMode: str(fd, "paymentMode") === "GCASH_PAYMONGO" ? "GCASH_PAYMONGO" : "GCASH_MANUAL",
        gcashName: str(fd, "gcashName"), gcashNumber: str(fd, "gcashNumber"), gcashQrPath: str(fd, "gcashQrPath"),
        policyText: str(fd, "policyText"),
        contactInfo: str(fd, "contactInfo"),
        staffEmails: str(fd, "staffEmails").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
        smsEvents: fd.getAll("smsEvents").map(String).filter((e) => ["BOOKING_CONFIRMED", "REMINDER", "RESCHEDULED", "PAYMENT_REJECTED"].includes(e)),
      },
      user,
    );
    return { ok: true, message: "Settings saved." };
  });
}

export async function addStaffAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    const pw = await addStaff(str(fd, "name"), str(fd, "email"), user);
    return { ok: true, message: "Staff account created. Give them this temporary password:", secret: pw };
  });
}

export async function resetPasswordAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    const pw = await resetPassword(str(fd, "userId"), user);
    return { ok: true, message: "Password reset. Their new temporary password:", secret: pw };
  });
}

export async function setActiveAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    await setActive(str(fd, "userId"), str(fd, "active") === "1", user);
    return { ok: true };
  });
}

export async function changePasswordAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    if (str(fd, "next") !== str(fd, "confirm")) return { ok: false, error: "The new passwords don't match." };
    const updated = await changeOwnPassword(user.id, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""));
    startSession(updated); // other devices are logged out; this one stays in
    return { ok: true, message: "Password changed. You've been logged out on other devices." };
  });
}

export async function sendTestEmailAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    const to = str(fd, "to") || user.email;
    try {
      await sendEmail(to, {
        subject: "Test email from your booking system",
        text: "If you can read this, booking emails are working.",
        html: "<p>If you can read this, booking emails are working.</p>",
      });
    } catch (e) {
      if (e instanceof NotConfigured) return { ok: false, error: "Email isn't set up yet. Add the SMTP settings (see README), then try again." };
      return { ok: false, error: `Sending failed: ${(e as Error).message}` };
    }
    return { ok: true, message: `Sent to ${to}. Check the inbox (and spam folder).` };
  });
}

// ---------------------------------------------------------------- open play (paddle stacking)
export async function createOpenPlayAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const s = await createOpenPlay({
      date: str(fd, "date"), startMinute: minute(fd, "start"), endMinute: minute(fd, "end"),
      rateCentavosPerHour: centavos(fd, "rate"), maxPlayers: int(fd, "maxPlayers"), notes: str(fd, "notes"),
    }, user);
    return { ok: true, message: "Open play scheduled. The court is blocked for those hours.", redirect: `/admin/open-play/${s.id}` };
  });
}

export async function cancelOpenPlayAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await cancelOpenPlay(str(fd, "sessionId"), user);
    return { ok: true, message: "Cancelled. The court is open for bookings again.", redirect: "/admin/open-play" };
  });
}

export async function closeOpenPlayAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await closeOpenPlay(str(fd, "sessionId"), user);
    return { ok: true, message: "Session closed." };
  });
}

export async function addOpenPlayPlayerAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const p = await addPlayer(str(fd, "sessionId"), str(fd, "name"), str(fd, "mobile"), user);
    return { ok: true, message: `${p.name} added to the line.` };
  });
}

export async function startOpenPlayGameAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const next = await startNextGame(str(fd, "sessionId"), user);
    return { ok: true, message: `On court: ${next.map((p) => p.name).join(", ")}` };
  });
}

export async function finishOpenPlayGameAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const { next } = await finishGame(str(fd, "sessionId"), str(fd, "startNext") === "1", user);
    return {
      ok: true,
      message: next ? `Next game: ${next.map((p) => p.name).join(", ")}` : "Game over. Not enough players in line for the next game yet.",
    };
  });
}

export async function moveOpenPlayToBackAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await moveToBack(str(fd, "playerId"), user);
  });
}

export async function restOpenPlayAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await setResting(str(fd, "playerId"), str(fd, "resting") === "1", user);
  });
}

export async function checkOutOpenPlayAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const method = str(fd, "method");
    const r = await checkOutPlayer(
      str(fd, "playerId"), method === "CASH" || method === "GCASH_MANUAL" ? method : null, str(fd, "gcashRef"), user,
    );
    const pesos = `₱${(r.centavos / 100).toLocaleString("en-PH")}`;
    return {
      ok: true,
      message: `${r.name} checked out: ${r.hours} hr, ${pesos}.${r.substitute ? ` ${r.substitute} takes their place on court.` : ""}`,
    };
  });
}

// ---------------------------------------------------------------- scoreboard
export async function newRefereeLinkAction() {
  return run(async () => {
    const user = await requireUser(["OWNER"]);
    await newRefereeToken(user);
    return { ok: true, message: "New referee link made. The old link and QR no longer work." };
  });
}

export async function abandonMatchAction(fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await abandonMatchAsStaff(str(fd, "matchId"), user);
    return { ok: true, message: "Match cancelled. No result was saved." };
  });
}
