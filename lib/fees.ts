import type { FeeBreakdown, Impound } from "./types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Storage is billed per calendar day, with the tow date counting as day 1.
 * Real impound billing is jurisdiction-specific; this matches typical
 * Virginia private-property practice and is easy to swap later.
 */
export function computeFees(impound: Impound, now: Date = new Date()): FeeBreakdown {
  const towed = new Date(impound.towedAt);
  const elapsedDays = Math.max(
    1,
    Math.ceil((now.getTime() - towed.getTime()) / MS_PER_DAY),
  );
  const storage = impound.fees.storageDaily * elapsedDays;
  const total = impound.fees.towing + storage + impound.fees.admin;
  return {
    towing: impound.fees.towing,
    storage,
    admin: impound.fees.admin,
    total,
    storageDays: elapsedDays,
  };
}

export function formatUSD(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
