/**
 * Demo traffic for one product, so the charts have a shape to judge.
 *
 * Writes Clicks and Commissions across the last 120 days for affiliates it
 * creates itself, every one of them named `demo-*@supaffi.test`, which is
 * what `--clear` deletes. It never touches an affiliate you did not make
 * here, and it never touches a Merchant, Program or Owner row.
 *
 *   node prisma/seed-demo.mjs <product-slug>
 *   node prisma/seed-demo.mjs <product-slug> --clear
 *
 * In the container:
 *   docker compose exec app node prisma/seed-demo.mjs <product-slug>
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SLUG = process.argv[2];
const CLEAR = process.argv.includes("--clear");
const DAYS = 120;
const MARK = "@supaffi.test";

if (!SLUG) {
  console.error("Usage: node prisma/seed-demo.mjs <product-slug> [--clear]");
  process.exit(1);
}

/** Repeatable, so two runs of the same command draw the same chart. */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const random = makeRandom(20260912);

function at(daysAgo, hour) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour, Math.floor(random() * 60), Math.floor(random() * 60), 0);
  return date;
}

/**
 * Traffic with a shape: a weekly rhythm, a slow climb over the window, and
 * two spikes. Flat noise makes a chart nothing can be judged from.
 */
function clicksOn(daysAgo) {
  const day = DAYS - daysAgo;
  const weekday = (new Date(Date.now() - daysAgo * 86400000).getUTCDay() + 6) % 7;
  const weekend = weekday >= 5 ? 0.45 : 1;
  const growth = 0.4 + (day / DAYS) * 1.6;
  const spike = daysAgo === 12 || daysAgo === 41 ? 3.2 : 1;
  const base = 14 * growth * weekend * spike;
  return Math.max(0, Math.round(base + (random() - 0.5) * base * 0.7));
}

async function main() {
  const merchant = await db.merchant.findFirst({
    where: { slug: SLUG },
    select: { id: true, name: true, slug: true },
  });
  if (!merchant) {
    console.error(`No product with slug "${SLUG}".`);
    process.exit(1);
  }

  const existing = await db.affiliate.findMany({
    where: { merchantId: merchant.id, email: { endsWith: MARK } },
    select: { id: true },
  });
  const ids = existing.map((a) => a.id);

  if (ids.length > 0) {
    // Commissions point at clicks, so they go first.
    await db.commission.deleteMany({ where: { affiliateId: { in: ids } } });
    await db.click.deleteMany({ where: { affiliateId: { in: ids } } });
    await db.affiliateLink.deleteMany({ where: { affiliateId: { in: ids } } });
    await db.affiliate.deleteMany({ where: { id: { in: ids } } });
    console.log(`Removed ${ids.length} demo affiliates and everything they carried.`);
  }
  if (CLEAR) return;

  const program = await db.program.findFirst({
    where: { merchantId: merchant.id },
    select: { id: true, defaultCommissionRate: true },
  });
  if (!program) {
    console.error(`"${merchant.name}" has no program yet. Finish onboarding first.`);
    process.exit(1);
  }

  const names = ["Sarah Kim", "Tom Alvarez", "Priya Nair", "Jonas Weber", "Lena Costa", "Max Dubois"];
  const affiliates = [];
  const linkByAffiliate = new Map();
  for (const [index, name] of names.entries()) {
    const affiliate = await db.affiliate.create({
      data: {
        merchantId: merchant.id,
        programId: program.id,
        email: `demo-${index + 1}${MARK}`,
        name,
        payoutDetails: "demo@paypal.test",
      },
      select: { id: true },
    });
    const link = await db.affiliateLink.create({
      data: {
        affiliateId: affiliate.id,
        code: `demo-${merchant.slug}-${index + 1}`,
        isPrimary: true,
      },
      select: { id: true },
    });
    affiliates.push(affiliate.id);
    linkByAffiliate.set(affiliate.id, link.id);
  }

  const currencies = ["usd", "usd", "usd", "eur"];
  const statuses = ["PAID", "PAID", "PAYABLE", "PENDING", "PENDING", "VOIDED"];
  let clickCount = 0;
  let commissionCount = 0;

  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const total = clicksOn(daysAgo);
    for (let i = 0; i < total; i += 1) {
      const affiliateId = affiliates[Math.floor(random() * affiliates.length)];
      const createdAt = at(daysAgo, 8 + Math.floor(random() * 13));
      const click = await db.click.create({
        data: {
          affiliateId,
          linkId: linkByAffiliate.get(affiliateId),
          referralToken: `demo-${daysAgo}-${i}-${Math.floor(random() * 1e9)}`,
          expiresAt: new Date(createdAt.getTime() + 60 * 86400000),
          createdAt,
        },
        select: { id: true },
      });
      clickCount += 1;

      // Roughly one in fourteen clicks buys something, which is a believable
      // rate for an affiliate program and keeps the bars readable.
      if (random() > 0.93) {
        const saleAmount = [29, 49, 99, 149][Math.floor(random() * 4)];
        const rate = Number(program.defaultCommissionRate ?? 20);
        const status = statuses[Math.floor(random() * statuses.length)];
        await db.commission.create({
          data: {
            affiliateId,
            clickId: click.id,
            amount: ((saleAmount * rate) / 100).toFixed(2),
            grossAmount: ((saleAmount * rate) / 100).toFixed(2),
            saleAmount: saleAmount.toFixed(2),
            stripePaymentRef: `demo_pi_${click.id}`,
            currency: currencies[Math.floor(random() * currencies.length)],
            status,
            payableAt: new Date(createdAt.getTime() + 30 * 86400000),
            paidAt: status === "PAID" ? new Date(createdAt.getTime() + 35 * 86400000) : null,
            voidedAt: status === "VOIDED" ? new Date(createdAt.getTime() + 2 * 86400000) : null,
            createdAt,
          },
        });
        commissionCount += 1;
      }
    }
  }

  console.log(
    `Seeded ${merchant.name}: ${affiliates.length} affiliates, ${clickCount} clicks, ${commissionCount} commissions over ${DAYS} days.`
  );
  console.log("Remove it all with: node prisma/seed-demo.mjs " + SLUG + " --clear");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
