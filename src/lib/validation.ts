import { z } from "zod";
import { normalizePhMobile } from "./phone";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

const customer = {
  name: z.string().trim().min(2, "Enter your full name").max(80, "Name is too long"),
  mobile: z
    .string()
    .transform((v, ctx) => {
      const n = normalizePhMobile(v);
      if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid PH mobile number, e.g. 0917 123 4567" });
      return n ?? "";
    }),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(120),
  agreePolicy: z.literal(true, { errorMap: () => ({ message: "Please agree to the booking policy" }) }),
  agreePrivacy: z.literal(true, { errorMap: () => ({ message: "Please agree to the privacy notice" }) }),
  website: z.string().max(0).optional(), // honeypot: real people leave this empty
};

export const CreateBookingSchema = z.discriminatedUnion("amenity", [
  z.object({
    amenity: z.literal("COURT"),
    amenityId: z.string().uuid(),
    date: dateString,
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
    players: z.number().int().min(1, "At least 1 player").max(12, "Maximum 12 players"),
    ...customer,
  }),
  z.object({
    amenity: z.literal("POOL"),
    sessionId: z.string().uuid(),
    date: dateString,
    adults: z.number().int().min(1, "At least 1 adult").max(30),
    kids: z.number().int().min(0).max(29),
    ...customer,
  }),
]);

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;

export const AvailabilityQuerySchema = z.object({ date: dateString });
