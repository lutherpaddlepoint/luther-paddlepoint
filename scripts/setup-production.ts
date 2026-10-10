// One-time setup of a NEW, EMPTY production database: court, pool, rates, settings and the
// owner account. No sample bookings. Refuses to run if the database already has data.
//   npm run setup:production -- --name "Owner Name" --email owner@gmail.com
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/passwords";
import { COURT_RATES, DEFAULT_SETTINGS, POOL_CAPACITY, POOL_RATES, POOL_SESSIONS } from "../src/lib/defaults";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const name = arg("name")?.trim();
  const email = arg("email")?.trim().toLowerCase();
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Usage: npm run setup:production -- --name "Owner Name" --email owner@gmail.com');

  const [users, amenities] = await Promise.all([prisma.user.count(), prisma.amenity.count()]);
  if (users > 0 || amenities > 0) throw new Error("This database already has data. Setup only runs once, on an empty database.");

  const password = randomBytes(9).toString("base64url");
  await prisma.$transaction(async (tx) => {
    await tx.user.create({ data: { name, email, role: "OWNER", passwordHash: await hashPassword(password) } });
    const court = await tx.amenity.create({ data: { type: "COURT", name: "Pickleball Court 1" } });
    const pool = await tx.amenity.create({ data: { type: "POOL", name: "Swimming Pool", capacity: POOL_CAPACITY } });
    await tx.rateRule.createMany({
      data: [
        ...COURT_RATES.map((r) => ({ ...r, guestType: null, amenityId: court.id })),
        ...POOL_RATES.map((r) => ({ ...r, guestType: r.guestType ?? null, amenityId: pool.id })),
      ],
    });
    for (const s of POOL_SESSIONS) await tx.poolSession.create({ data: { ...s, amenityId: pool.id } });
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
      await tx.setting.create({ data: { key, value: value as never } });
    await tx.auditLog.create({ data: { action: "PRODUCTION_SETUP", entity: "system", details: { owner: email } } });
  }, { timeout: 30_000 });

  console.log(`
Production setup complete.

  Owner login : ${email}
  Password    : ${password}

Save this password now (it is shown only once), log in at /admin/login and change it under "My account".
Then fill in GCash details, contact info and staff alert emails under Settings.`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
