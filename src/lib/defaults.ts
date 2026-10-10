// Starting configuration for Luther PaddlePoint & Pool.
// The seed copies these into the database; after that the owner edits them in the dashboard.

import type { RateRuleInput } from "./pricing";

export const FACILITY = {
  name: "Luther PaddlePoint & Pool",
  address: "Necesito Place, Poblacion 3, Lebak, Sultan Kudarat",
  timezone: "Asia/Manila",
  currency: "PHP",
};

export const OPEN_MINUTE = 6 * 60; // 6:00 AM
export const CLOSE_MINUTE = 22 * 60; // 10:00 PM
export const DAY_NIGHT_CUTOFF = 17 * 60; // 5:00 PM

export const COURT_RATES: RateRuleInput[] = [
  { label: "Day rate", startMinute: OPEN_MINUTE, endMinute: DAY_NIGHT_CUTOFF, priceCentavos: 200_00, unit: "PER_HOUR" },
  { label: "Night rate", startMinute: DAY_NIGHT_CUTOFF, endMinute: CLOSE_MINUTE, priceCentavos: 250_00, unit: "PER_HOUR" },
];

// Same price for day and night sessions.
export const POOL_RATES: RateRuleInput[] = [
  { label: "Adult entrance", startMinute: OPEN_MINUTE, endMinute: CLOSE_MINUTE, priceCentavos: 50_00, unit: "PER_PERSON", guestType: "ADULT" },
  { label: "Kid entrance (10 & below)", startMinute: OPEN_MINUTE, endMinute: CLOSE_MINUTE, priceCentavos: 30_00, unit: "PER_PERSON", guestType: "KID" },
];

export const POOL_CAPACITY = 30;

export const POOL_SESSIONS = [
  { name: "Day session", startMinute: OPEN_MINUTE, endMinute: DAY_NIGHT_CUTOFF },
  { name: "Night session", startMinute: DAY_NIGHT_CUTOFF, endMinute: CLOSE_MINUTE },
];

export type AppSettings = {
  facility: typeof FACILITY;
  operating_hours: { openMinute: number; closeMinute: number };
  lights_on_minute: number; // when the night rate starts (court lights on)
  reservation_fee_percent: number;
  reservation_fee_refundable: boolean;
  court_min_hours: number;
  kid_max_age: number;
  payment_mode: "GCASH_MANUAL" | "GCASH_PAYMONGO";
  gcash_account: { name: string; number: string; qrImagePath: string | null };
  hold_minutes: { GCASH_MANUAL: number; GCASH_PAYMONGO: number };
  reschedule_policy: { allowed: boolean; maxTimes: number; minHoursBefore: number };
  reminder_hours_before: number;
  booking_window_days: number;
  pool_booking_cutoff_minutes: number; // stop online pool booking this long before a session ends
  policy_text: string;
  contact_info: string; // shown in emails, e.g. "0917 123 4567 or facebook.com/yourpage"
  notifications: {
    smsEvents: string[]; // customer SMS events (each SMS costs money)
    staffEmails: string[]; // who gets "payment to check" and "needs attention" emails
  };
};

export const DEFAULT_SETTINGS: AppSettings = {
  facility: FACILITY,
  operating_hours: { openMinute: OPEN_MINUTE, closeMinute: CLOSE_MINUTE },
  lights_on_minute: DAY_NIGHT_CUTOFF,
  reservation_fee_percent: 50,
  reservation_fee_refundable: false,
  court_min_hours: 1,
  kid_max_age: 10,
  payment_mode: "GCASH_MANUAL", // switch to "GCASH_PAYMONGO" after business registration
  // Edit before seeding. Put your GCash QR image at public/gcash-qr.png, then set qrImagePath: "/gcash-qr.png".
  gcash_account: { name: "[GCASH ACCOUNT NAME]", number: "[09XX XXX XXXX]", qrImagePath: null },
  hold_minutes: { GCASH_MANUAL: 30, GCASH_PAYMONGO: 10 },
  reschedule_policy: { allowed: true, maxTimes: 1, minHoursBefore: 24 },
  reminder_hours_before: 2,
  booking_window_days: 30, // how far ahead customers can book
  pool_booking_cutoff_minutes: 60,
  policy_text:
    "The reservation fee (50% of the total) is non-refundable. The remaining balance is paid on-site. " +
    "You may reschedule once if you request it at least 24 hours before your booking.",
  contact_info: "[mobile number or Facebook page]",
  notifications: { smsEvents: ["BOOKING_CONFIRMED", "REMINDER"], staffEmails: [] },
};
