// Staff tool for GCash payments until the dashboard arrives in Phase 5.
//   npm run payments                          list proofs waiting for checking
//   npm run payments approve LPP-XXXXX        confirm the booking
//   npm run payments reject LPP-XXXXX "Not received in GCash"
import { prisma } from "../src/lib/db";
import { confirmPayment, rejectPayment, pendingManualPayments } from "../src/lib/payments";
import { signedProofUrl } from "../src/lib/storage";
import { formatPeso } from "../src/lib/pricing";
import { formatMinute, utcToManila } from "../src/lib/time";

const [cmd, ref, ...rest] = process.argv.slice(2);

async function pendingFor(referenceCode: string) {
  const b = await prisma.booking.findUnique({
    where: { referenceCode },
    include: { payments: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" } } },
  });
  if (!b) throw new Error(`No booking ${referenceCode}`);
  const p = b.payments[0];
  if (!p) throw new Error(`${referenceCode} has no payment waiting to be checked.`);
  return p;
}

async function staffUser() {
  const u = await prisma.user.findFirst({ where: { role: "OWNER", isActive: true } });
  if (!u) throw new Error("No owner account found. Run the seed first.");
  return u;
}

async function main() {
  if (!cmd || cmd === "list") {
    const list = await pendingManualPayments();
    if (list.length === 0) return console.log("No payments waiting to be checked.");
    for (const p of list) {
      const s = utcToManila(p.booking.startAt);
      const link = p.proofImagePath ? await signedProofUrl(p.proofImagePath, 900).catch(() => "(could not create link)") : "-";
      console.log(`
${p.booking.referenceCode}  ${p.booking.amenity.name}, ${s.date} ${formatMinute(s.minuteOfDay)}
  Customer : ${p.booking.customerName}  ${p.booking.mobile}
  Amount   : ${formatPeso(p.amountCentavos)}   GCash Ref. No.: ${p.gcashReference}
  Status   : ${p.booking.status}${p.booking.attentionReason ? `  ⚠ ${p.booking.attentionReason}` : ""}
  Receipt  : ${link}`);
    }
    console.log("\nCheck each one in your GCash app (amount + Ref. No.), then approve or reject.");
    return;
  }
  if (!ref) throw new Error("Give the booking reference, e.g. LPP-7K3QX");
  const user = await staffUser();
  const payment = await pendingFor(ref.toUpperCase());

  if (cmd === "approve") {
    const result = await confirmPayment(payment.id, { userId: user.id, source: "STAFF" });
    console.log(`${ref}: ${result}`);
  } else if (cmd === "reject") {
    await rejectPayment(payment.id, user.id, rest.join(" ") || "Payment not received");
    console.log(`${ref}: rejected, slot released.`);
  } else {
    throw new Error(`Unknown command "${cmd}". Use list, approve or reject.`);
  }
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
