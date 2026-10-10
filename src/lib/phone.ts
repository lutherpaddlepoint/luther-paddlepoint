// Philippine mobile numbers. Accepts 0917 123 4567, +63 917 123 4567, 639171234567, 9171234567.
// Returns the standard 11-digit form "09171234567", or null if it isn't a valid PH mobile.
export function normalizePhMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  let local: string;
  if (/^\+639\d{9}$/.test(digits)) local = "0" + digits.slice(3);
  else if (/^639\d{9}$/.test(digits)) local = "0" + digits.slice(2);
  else if (/^09\d{9}$/.test(digits)) local = digits;
  else if (/^9\d{9}$/.test(digits)) local = "0" + digits;
  else return null;
  return local;
}

/** "09171234567" -> "0917 123 4567" */
export const formatPhMobile = (n: string) => `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
