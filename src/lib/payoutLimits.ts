/**
 * No page renders anywhere near this many rows in one payout. Its own module
 * so the analytics helpers the dashboards import in the browser do not pull
 * in the payout code, and the mail sending it queues, with it.
 */
export const MAX_SHOWN = 5000;
