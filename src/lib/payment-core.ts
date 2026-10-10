// Pure payment helpers (no database or network) — easy to test.
import { createHmac, timingSafeEqual } from "node:crypto";

/** GCash "Ref No." from the receipt. Spaces are ignored. Returns digits only, or null. */
export function normalizeGcashRef(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{10,16}$/.test(digits) ? digits : null;
}

export type ImageType = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

/** Identify the image from its first bytes, not from the file name or browser-reported type. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b))
    return { mime: "image/png", ext: "png" };
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return { mime: "image/webp", ext: "webp" };
  return null;
}

export const MAX_PROOF_BYTES = 4 * 1024 * 1024; // Vercel limits request bodies to ~4.5 MB

/**
 * PayMongo webhook signature check.
 * Header looks like: "t=1700000000,te=<hex for test mode>,li=<hex for live mode>"
 * Signature = HMAC-SHA256( "<t>.<raw body>", webhook secret ), hex encoded.
 */
export function verifyPaymongoSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  livemode: boolean,
): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = parts.t;
  const given = livemode ? parts.li : parts.te;
  if (!t || !given) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
