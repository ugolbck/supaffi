/**
 * Demo traffic for one product, so the dashboards have something to show.
 *
 * Writes affiliates who join over time, their clicks, and the commissions
 * those clicks turned into, with statuses that follow the calendar: recent
 * sales are still pending, older ones payable or paid in batches, a few
 * flagged, voided or clawed back. On a recurring program most sales are
 * subscriptions that renew monthly until some of them cancel.
 *
 * Every affiliate it makes is `demo-*@supaffi.test`, which is exactly what
 * `--clear` deletes. It never touches an affiliate it did not make.
 * `--backdate` is the one exception to leaving other rows alone: it moves the
 * product's and its program's creation date back to the start of the demo
 * history, so "All time" has the whole history to draw.
 *
 *   node prisma/seed-demo.mjs <product-slug>
 *   node prisma/seed-demo.mjs <product-slug> --days 400 --affiliates 40 --backdate
 *   node prisma/seed-demo.mjs <product-slug> --currency eur
 *   node prisma/seed-demo.mjs <product-slug> --clear
 *
 * In the container:
 *   docker compose exec app node prisma/seed-demo.mjs <product-slug>
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const args = process.argv.slice(2);
// The product comes first, before any option.
const SLUG = args[0];
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const CLEAR = flag("clear");
const BACKDATE = flag("backdate");
const DAYS = Number(option("days", 120));
const AFFILIATES = Number(option("affiliates", 6));
const PRIMARY = option("currency", "usd");
const MARK = "@supaffi.test";
const DAY = 86_400_000;
const NOW = Date.now();

if (!SLUG || SLUG.startsWith("--")) {
  console.error("Usage: node prisma/seed-demo.mjs <product-slug> [--days N] [--affiliates N] [--currency usd] [--backdate] [--clear]");
  process.exit(1);
}

/** Repeatable, so two runs of the same command draw the same dashboards. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const random = makeRandom([...SLUG].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
const pick = (list) => list[Math.floor(random() * list.length)];

const FIRST = ["Sarah", "Tom", "Priya", "Jonas", "Lena", "Max", "Aisha", "Diego", "Mei", "Oskar", "Chloe", "Ravi", "Noah", "Ines", "Kenji", "Zara", "Lucas", "Amara", "Felix", "Hana", "Omar", "Elena", "Theo", "Nadia", "Sam", "Yuki", "Marco", "Freya", "Ahmed", "Clara"];
const LAST = ["Kim", "Alvarez", "Nair", "Weber", "Costa", "Dubois", "Okafor", "Rossi", "Tanaka", "Berg", "Martin", "Shah", "Levi", "Moreau", "Ito", "Khan", "Silva", "Novak", "Fischer", "Park"];
const PATHS = ["/pricing", "/features", "/blog/launch", "/templates", "/compare", "/changelog"];

const PRICES = {
  usd: [29, 49, 99, 149, 299],
  eur: [25, 45, 89, 139, 249],
  gbp: [19, 39, 79, 129],
};
const OTHER_CURRENCIES = { usd: ["eur", "gbp"], eur: ["usd", "gbp"], gbp: ["usd", "eur"] };

function currencyFor() {
  const r = random();
  if (r < 0.82) return PRIMARY;
  return pick(OTHER_CURRENCIES[PRIMARY] ?? ["usd"]);
}

/** Owners pay in batches, on the 1st and the 15th, so payouts group like real ones. */
function nextPayoutDay(from) {
  const d = new Date(from);
  const day = d.getUTCDate();
  const batch =
    day < 15
      ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15, 10))
      : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 10));
  return batch;
}

/** A moment on a given day, weighted towards the working afternoon, never in the future. */
function momentOn(daysAgo) {
  const base = new Date(NOW - daysAgo * DAY);
  base.setUTCHours(0, 0, 0, 0);
  const hour = Math.min(23, Math.max(0, Math.round(14 + (random() + random() + random() - 1.5) * 7)));
  const at = new Date(base.getTime() + hour * 3_600_000 + Math.floor(random() * 3_600_000));
  return at.getTime() > NOW ? new Date(NOW - Math.floor(random() * 3_600_000)) : at;
}

async function insertMany(model, rows) {
  for (let i = 0; i < rows.length; i += 2000) {
    await db[model].createMany({ data: rows.slice(i, i + 2000) });
  }
}

async function clearDemo(merchantId) {
  const ids = (
    await db.affiliate.findMany({ where: { merchantId, email: { endsWith: MARK } }, select: { id: true } })
  ).map((a) => a.id);
  if (ids.length === 0) return 0;
  // Adjustments point at the commission they correct, so they go first, then
  // commissions, which point at clicks, which point at links.
  await db.commission.deleteMany({ where: { affiliateId: { in: ids }, adjustsCommissionId: { not: null } } });
  await db.commission.deleteMany({ where: { affiliateId: { in: ids } } });
  await db.click.deleteMany({ where: { affiliateId: { in: ids } } });
  await db.affiliateLink.deleteMany({ where: { affiliateId: { in: ids } } });
  await db.affiliateLoginToken.deleteMany({ where: { affiliateId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

async function main() {
  const merchant = await db.merchant.findFirst({
    where: { slug: SLUG },
    select: { id: true, name: true, slug: true, createdAt: true },
  });
  if (!merchant) {
    console.error(`No product with slug "${SLUG}".`);
    process.exit(1);
  }

  const removed = await clearDemo(merchant.id);
  if (removed > 0) console.log(`Removed ${removed} demo affiliates and everything they carried.`);
  if (CLEAR) return;

  const program = await db.program.findFirst({
    where: { merchantId: merchant.id },
    select: {
      id: true,
      defaultCommissionRate: true,
      commissionDurationType: true,
      commissionDurationMonths: true,
      holdingPeriodDays: true,
      createdAt: true,
    },
  });
  if (!program) {
    console.error(`"${merchant.name}" has no program yet. Finish onboarding first.`);
    process.exit(1);
  }

  const start = new Date(NOW - DAYS * DAY);
  if (BACKDATE) {
    if (merchant.createdAt > start) {
      await db.merchant.update({ where: { id: merchant.id }, data: { createdAt: start } });
    }
    if (program.createdAt > start) {
      await db.program.update({ where: { id: program.id }, data: { createdAt: start } });
    }
  }

  const baseRate = Number(program.defaultCommissionRate);
  const recurring = program.commissionDurationType !== "ONE_TIME";
  const maxMonths = program.commissionDurationType === "FIXED_MONTHS" ? program.commissionDurationMonths ?? 12 : Infinity;
  const hold = program.holdingPeriodDays;

  // Affiliates join over the window, most of them early. Activity follows a
  // long tail: a couple of stars, a middle, and many who send a trickle.
  const affiliates = [];
  const links = [];
  const usedNames = new Set();
  for (let i = 0; i < AFFILIATES; i += 1) {
    let name;
    do {
      name = `${pick(FIRST)} ${pick(LAST)}`;
    } while (usedNames.has(name) && usedNames.size < FIRST.length * LAST.length);
    usedNames.add(name);

    const joinedDaysAgo = Math.floor(DAYS * Math.pow(random(), 0.55) * 0.95);
    const id = randomUUID();
    const vip = random() < 0.1;
    affiliates.push({
      id,
      merchantId: merchant.id,
      programId: program.id,
      email: `demo-${i + 1}${MARK}`,
      name,
      customCommissionRate: vip ? (baseRate + 10).toFixed(2) : null,
      // A few without payout details, so the "nowhere to send it" state shows.
      payoutDetails: random() < 0.85 ? `${name.split(" ")[0].toLowerCase()}@paypal.test` : null,
      createdAt: new Date(NOW - joinedDaysAgo * DAY),
      weight: 1 / Math.pow(i + 1, 1.05),
      joinedDaysAgo,
      rate: vip ? baseRate + 10 : baseRate,
      linkIds: [],
    });

    const primaryId = randomUUID();
    links.push({ id: primaryId, affiliateId: id, code: `demo-${merchant.slug}-${i + 1}`, isPrimary: true, createdAt: new Date(NOW - joinedDaysAgo * DAY) });
    affiliates[i].linkIds.push(primaryId);
    const extra = random() < 0.35 ? 1 + Math.floor(random() * 3) : 0;
    for (let k = 0; k < extra; k += 1) {
      const linkId = randomUUID();
      links.push({
        id: linkId,
        affiliateId: id,
        code: `demo-${merchant.slug}-${i + 1}-${k + 1}`,
        isPrimary: false,
        destinationPath: PATHS[(i + k) % PATHS.length],
        createdAt: new Date(NOW - Math.max(0, joinedDaysAgo - 10 * (k + 1)) * DAY),
      });
      affiliates[i].linkIds.push(linkId);
    }
  }

  await insertMany(
    "affiliate",
    affiliates.map(({ weight, joinedDaysAgo, rate, linkIds, ...row }) => row)
  );
  await insertMany("affiliateLink", links);

  // Traffic with a shape: a weekly rhythm, growth across the window, and a
  // handful of launch spikes. Flat noise makes a chart nothing can be judged
  // from.
  const spikes = new Set(Array.from({ length: Math.max(2, Math.floor(DAYS / 60)) }, () => Math.floor(random() * DAYS)));
  const clicks = [];
  const commissions = [];
  let flaggedEmailCount = 0;

  function statusFor(createdAt) {
    const age = (NOW - createdAt.getTime()) / DAY;
    const r = random();
    const payableAt = new Date(createdAt.getTime() + hold * DAY);
    if (r < 0.025) {
      return { status: "VOIDED", payableAt, voidReason: random() < 0.75 ? "refund" : "confirmed self-referral", voidedAt: new Date(Math.min(NOW, createdAt.getTime() + (2 + random() * 10) * DAY)) };
    }
    if (age < hold) {
      if (r < 0.07) return { status: "FLAGGED", payableAt, flag: true };
      return { status: "PENDING", payableAt };
    }
    const paidAt = nextPayoutDay(payableAt);
    if (paidAt.getTime() > NOW || r < 0.12) return { status: "PAYABLE", payableAt };
    return { status: "PAID", payableAt, paidAt };
  }

  function addCommission(affiliate, clickId, createdAt, currency, saleAmount) {
    const amount = Math.round(saleAmount * affiliate.rate) / 100;
    const s = statusFor(createdAt);
    const row = {
      id: randomUUID(),
      affiliateId: affiliate.id,
      clickId,
      stripePaymentRef: `demo_${randomUUID()}`,
      amount: amount.toFixed(2),
      grossAmount: amount.toFixed(2),
      saleAmount: saleAmount.toFixed(2),
      currency,
      status: s.status,
      payableAt: s.payableAt,
      paidAt: s.paidAt ?? null,
      voidedAt: s.voidedAt ?? null,
      voidReason: s.voidReason ?? null,
      flagReason: s.flag
        ? random() < 0.6
          ? `email:buyer${++flaggedEmailCount}@example.com ${affiliate.email}`
          : "card"
        : null,
      createdAt,
    };
    commissions.push(row);

    // Now and then a refund lands after the payout: a negative row that
    // carries to the next one.
    if (row.status === "PAID" && random() < 0.02) {
      const at = new Date(Math.min(NOW, row.paidAt.getTime() + (3 + random() * 20) * DAY));
      commissions.push({
        id: randomUUID(),
        affiliateId: affiliate.id,
        clickId,
        adjustsCommissionId: row.id,
        stripePaymentRef: null,
        amount: (-amount).toFixed(2),
        grossAmount: null,
        saleAmount: null,
        currency,
        status: "PAYABLE",
        payableAt: at,
        paidAt: null,
        voidedAt: null,
        voidReason: null,
        flagReason: null,
        createdAt: at,
      });
    }
  }

  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const day = DAYS - daysAgo;
    const weekday = (new Date(NOW - daysAgo * DAY).getUTCDay() + 6) % 7;
    const weekend = weekday >= 5 ? 0.55 : 1;
    const growth = 0.25 + Math.pow(day / DAYS, 1.3) * 1.75;
    const spike = spikes.has(daysAgo) ? 2.6 + random() * 1.4 : 1;
    const active = affiliates.filter((a) => a.joinedDaysAgo >= daysAgo);
    if (active.length === 0) continue;
    const totalWeight = active.reduce((sum, a) => sum + a.weight, 0);

    const base = (18 + AFFILIATES * 1.6) * growth * weekend * spike;
    const total = Math.max(0, Math.round(base * (0.7 + random() * 0.6)));

    for (let i = 0; i < total; i += 1) {
      let roll = random() * totalWeight;
      let affiliate = active[0];
      for (const a of active) {
        roll -= a.weight;
        if (roll <= 0) {
          affiliate = a;
          break;
        }
      }
      const createdAt = momentOn(daysAgo);
      const clickId = randomUUID();
      const click = {
        id: clickId,
        affiliateId: affiliate.id,
        linkId: pick(affiliate.linkIds),
        referralToken: `demo_${randomUUID()}`,
        expiresAt: new Date(createdAt.getTime() + 60 * DAY),
        createdAt,
        stripeCustomerId: null,
        subscriptionCancelledAt: null,
      };
      clicks.push(click);

      // About one click in eighteen buys, which keeps the bars readable next
      // to the line.
      if (random() > 0.055) continue;
      const currency = currencyFor();
      const price = pick(PRICES[currency] ?? PRICES.usd);
      const saleAt = new Date(Math.min(NOW, createdAt.getTime() + random() * 2 * DAY));
      addCommission(affiliate, clickId, saleAt, currency, price);

      if (!recurring || random() > 0.72) continue;
      // A subscription: renews monthly until it cancels, the program stops
      // paying on it, or the renewal would land in the future.
      click.stripeCustomerId = `cus_demo_${randomUUID()}`;
      let renewal = saleAt.getTime() + 30 * DAY;
      let months = 1;
      while (renewal < NOW && months < maxMonths) {
        if (random() < 0.07) {
          click.subscriptionCancelledAt = new Date(renewal - random() * 10 * DAY);
          break;
        }
        addCommission(affiliate, clickId, new Date(renewal), currency, price);
        renewal += 30 * DAY;
        months += 1;
      }
    }
  }

  await insertMany("click", clicks);
  // Originals before adjustments, so every adjustment has its commission.
  await insertMany("commission", commissions.filter((c) => !c.adjustsCommissionId));
  await insertMany("commission", commissions.filter((c) => c.adjustsCommissionId));

  const by = (status) => commissions.filter((c) => c.status === status).length;
  console.log(
    `Seeded ${merchant.name}: ${affiliates.length} affiliates, ${links.length} links, ${clicks.length} clicks, ` +
      `${commissions.length} commissions over ${DAYS} days ` +
      `(${by("PENDING")} pending, ${by("FLAGGED")} flagged, ${by("PAYABLE")} payable, ${by("PAID")} paid, ${by("VOIDED")} voided).`
  );
  console.log(`Remove it all with: node prisma/seed-demo.mjs ${SLUG} --clear`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
