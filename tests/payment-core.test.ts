import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { normalizeGcashRef, detectImageType, verifyPaymongoSignature } from "../src/lib/payment-core";

test("GCash reference numbers: spaces ignored, digits only", () => {
  assert.equal(normalizeGcashRef("1234 567 890123"), "1234567890123");
  assert.equal(normalizeGcashRef("1234567890123"), "1234567890123");
  assert.equal(normalizeGcashRef("12345"), null);
  assert.equal(normalizeGcashRef("ABC1234567890"), null);
});

test("image type is detected from file contents", () => {
  assert.deepEqual(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), { mime: "image/jpeg", ext: "jpg" });
  assert.deepEqual(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), { mime: "image/png", ext: "png" });
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  assert.equal(detectImageType(webp)?.ext, "webp");
  assert.equal(detectImageType(new TextEncoder().encode("%PDF-1.7")), null);
  assert.equal(detectImageType(new TextEncoder().encode("<svg>")), null);
});

test("PayMongo signature: valid test and live signatures pass, tampering fails", () => {
  const secret = "whsk_test_secret";
  const body = JSON.stringify({ data: { id: "evt_1" } });
  const t = "1760000000";
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

  assert.equal(verifyPaymongoSignature(`t=${t},te=${sig},li=`, body, secret, false), true);
  assert.equal(verifyPaymongoSignature(`t=${t},te=,li=${sig}`, body, secret, true), true);
  assert.equal(verifyPaymongoSignature(`t=${t},te=${sig},li=`, body + " ", secret, false), false); // body changed
  assert.equal(verifyPaymongoSignature(`t=${t},te=${sig},li=`, body, "wrong", false), false); // wrong secret
  assert.equal(verifyPaymongoSignature(`t=${t},te=${sig},li=`, body, secret, true), false); // live needs li
  assert.equal(verifyPaymongoSignature(null, body, secret, false), false);
  assert.equal(verifyPaymongoSignature("garbage", body, secret, false), false);
});
