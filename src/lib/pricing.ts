// Pricing engine. Pure functions — no database access — so they are easy to test.
// All amounts are integer centavos (₱200.00 = 20000).

import { dayOfWeek, formatMinute } from "./time";

export type RateRuleInput = {
  label: string;
  startMinute: number; // inclusive
  endMinute: number; // exclusive
  priceCentavos: number;
  unit: "PER_HOUR" | "PER_PERSON";
  guestType?: "ADULT" | "KID" | null;
  daysOfWeek?: number[];
  isActive?: boolean;
};

export type LineItem = {
  description: string;
  quantity: number;
  unitPriceCentavos: number;
  amountCentavos: number;
};

export type PriceQuote = {
  lineItems: LineItem[];
  totalCentavos: number;
  reservationFeeCentavos: number;
  balanceCentavos: number;
};

export class PricingError extends Error {}

export const appliesOn = (rule: RateRuleInput, dow: number) =>
  rule.isActive !== false && (rule.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]).includes(dow);

/**
 * Reservation fee = percent of total, rounded UP to the nearest whole peso.
 * The rest is the balance paid on-site. Fee + balance always equals total.
 */
export function splitReservationFee(totalCentavos: number, feePercent: number) {
  if (feePercent < 0 || feePercent > 100) throw new PricingError("Invalid reservation fee percent");
  const raw = (totalCentavos * feePercent) / 100;
  const fee = Math.min(totalCentavos, Math.ceil(raw / 100) * 100);
  return { reservationFeeCentavos: fee, balanceCentavos: totalCentavos - fee };
}

/**
 * Court price, computed hour by hour so a booking that crosses 5:00 PM
 * is charged the day rate before 5 PM and the night rate after.
 */
export function quoteCourt(args: {
  date: string; // Manila "YYYY-MM-DD"
  startMinute: number;
  endMinute: number;
  rules: RateRuleInput[];
  openMinute: number;
  closeMinute: number;
  feePercent: number;
  minHours?: number;
}): PriceQuote {
  const { date, startMinute, endMinute, rules, openMinute, closeMinute, feePercent } = args;
  const minHours = args.minHours ?? 1;

  if (startMinute % 60 !== 0 || endMinute % 60 !== 0)
    throw new PricingError("Court bookings must start and end on the hour.");
  if (endMinute <= startMinute) throw new PricingError("End time must be after start time.");
  if (startMinute < openMinute || endMinute > closeMinute)
    throw new PricingError(
      `Court is open ${formatMinute(openMinute)} to ${formatMinute(closeMinute)} only.`,
    );
  if ((endMinute - startMinute) / 60 < minHours)
    throw new PricingError(`Minimum booking is ${minHours} hour(s).`);

  const dow = dayOfWeek(date);
  const hourly = rules.filter((r) => r.unit === "PER_HOUR" && appliesOn(r, dow));

  // Price each hour, then merge consecutive hours that use the same rule into one line.
  const lineItems: LineItem[] = [];
  let groupStart = startMinute;
  let current: RateRuleInput | null = null;
  let count = 0;

  const flush = (groupEnd: number) => {
    if (!current) return;
    lineItems.push({
      description: `${current.label} (${formatMinute(groupStart)}–${formatMinute(groupEnd)})`,
      quantity: count,
      unitPriceCentavos: current.priceCentavos,
      amountCentavos: current.priceCentavos * count,
    });
  };

  for (let m = startMinute; m < endMinute; m += 60) {
    const rule = hourly.find((r) => m >= r.startMinute && m + 60 <= r.endMinute);
    if (!rule) throw new PricingError(`No court rate set for ${formatMinute(m)}.`);
    if (rule !== current) {
      flush(m);
      current = rule;
      groupStart = m;
      count = 0;
    }
    count += 1;
  }
  flush(endMinute);

  const totalCentavos = lineItems.reduce((s, li) => s + li.amountCentavos, 0);
  return { lineItems, totalCentavos, ...splitReservationFee(totalCentavos, feePercent) };
}

/** Pool price: adults and kids (10 and below) × per-person entrance rate. */
export function quotePool(args: {
  date: string;
  sessionStartMinute: number;
  adults: number;
  kids: number;
  rules: RateRuleInput[];
  feePercent: number;
}): PriceQuote {
  const { date, sessionStartMinute, adults, kids, rules, feePercent } = args;
  if (!Number.isInteger(adults) || !Number.isInteger(kids) || adults < 0 || kids < 0)
    throw new PricingError("Invalid number of guests.");
  if (adults + kids === 0) throw new PricingError("Please add at least one guest.");
  if (adults === 0) throw new PricingError("Kids must be accompanied by at least one adult.");

  const dow = dayOfWeek(date);
  const find = (guestType: "ADULT" | "KID") => {
    const rule = rules.find(
      (r) =>
        r.unit === "PER_PERSON" &&
        r.guestType === guestType &&
        appliesOn(r, dow) &&
        sessionStartMinute >= r.startMinute &&
        sessionStartMinute < r.endMinute,
    );
    if (!rule) throw new PricingError(`No pool rate set for ${guestType.toLowerCase()}s.`);
    return rule;
  };

  const lineItems: LineItem[] = [];
  if (adults > 0) {
    const r = find("ADULT");
    lineItems.push({
      description: r.label,
      quantity: adults,
      unitPriceCentavos: r.priceCentavos,
      amountCentavos: r.priceCentavos * adults,
    });
  }
  if (kids > 0) {
    const r = find("KID");
    lineItems.push({
      description: r.label,
      quantity: kids,
      unitPriceCentavos: r.priceCentavos,
      amountCentavos: r.priceCentavos * kids,
    });
  }

  const totalCentavos = lineItems.reduce((s, li) => s + li.amountCentavos, 0);
  return { lineItems, totalCentavos, ...splitReservationFee(totalCentavos, feePercent) };
}

export const formatPeso = (centavos: number) =>
  "₱" + (centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
