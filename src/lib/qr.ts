import QRCode from "qrcode";

// The QR holds only the reference code (no personal data, no private link).
// The staff check-in scanner looks for "LPP-XXXXX".
export const qrPng = (ref: string) => QRCode.toBuffer(ref, { type: "png", width: 360, margin: 1, errorCorrectionLevel: "M" });
export const qrSvg = (ref: string) => QRCode.toString(ref, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
