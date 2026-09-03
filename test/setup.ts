/**
 * Points the database-backed suites at a scratch database, and refuses to run
 * if that is not where they ended up.
 *
 * Several suites clear whole tables in `beforeEach`. They inherited
 * `DATABASE_URL` from `.env`, which is the development database, so running
 * the tests silently destroyed local data. The guard at the bottom is the real
 * fix: the database name has to end in `_test`, so a misconfigured environment
 * fails loudly instead of deleting something.
 *
 * `.env` has to be read here rather than left to Prisma. Prisma loads it when
 * the client is constructed, which is after this file runs, and it does not
 * overwrite a variable that is already set. Setting it here therefore wins.
 */
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";

// `.env.test` wins outright when present, for a scratch database somewhere
// else entirely. Otherwise derive the name from `.env`, so a fresh clone needs
// no extra file.
if (existsSync(".env.test")) {
  loadEnvFile(".env.test");
} else {
  if (existsSync(".env")) loadEnvFile(".env");
  const url = process.env.DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) {
    const scratch = new URL(url);
    scratch.pathname = `${scratch.pathname}_test`;
    process.env.DATABASE_URL = scratch.toString();
  }
}

const url = process.env.DATABASE_URL;
if (url) {
  // The path only. A password or host could end in "_test" by chance.
  const database = new URL(url).pathname.replace(/^\//, "");
  if (!database.endsWith("_test")) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at "${database}", not a scratch database. ` +
        `The suites clear whole tables. Use a database whose name ends in "_test".`
    );
  }
}
