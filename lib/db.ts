import fs from "node:fs";
import path from "node:path";
import type { Impound, PendingPickup, Release } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const SEED_PATH = path.join(DATA_DIR, "impounds.json");

type Store = {
  impounds: Impound[];
  releases: Release[];
  pending: PendingPickup[];
};

function loadSeed(): Store {
  const raw = fs.readFileSync(SEED_PATH, "utf8");
  const parsed = JSON.parse(raw) as { impounds: Impound[] };
  return { impounds: parsed.impounds, releases: [], pending: [] };
}

function readStore(): Store {
  if (!fs.existsSync(STORE_PATH)) {
    const seed = loadSeed();
    fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
  const raw = fs.readFileSync(STORE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<Store>;
  // Backfill for stores created before the pending-pickup schema existed.
  return {
    impounds: parsed.impounds ?? [],
    releases: parsed.releases ?? [],
    pending: parsed.pending ?? [],
  };
}

function writeStore(store: Store): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function findImpound(query: string): Impound | null {
  const q = query.trim().toUpperCase().replace(/[-\s]/g, "");
  if (!q) return null;
  const store = readStore();
  return (
    store.impounds.find((i) => {
      const idN = i.id.toUpperCase().replace(/[-\s]/g, "");
      const plateN = i.plate.toUpperCase().replace(/[-\s]/g, "");
      const vinN = i.vin.toUpperCase();
      return idN === q || plateN === q || vinN === q;
    }) ?? null
  );
}

export function getImpound(id: string): Impound | null {
  const store = readStore();
  return store.impounds.find((i) => i.id === id) ?? null;
}

export function createRelease(release: Release): void {
  const store = readStore();
  store.releases.push(release);
  writeStore(store);
}

export function getRelease(code: string): Release | null {
  const store = readStore();
  return store.releases.find((r) => r.code === code.toUpperCase()) ?? null;
}

export function getReleaseBySession(sessionId: string): Release | null {
  const store = readStore();
  return store.releases.find((r) => r.stripeSessionId === sessionId) ?? null;
}

export function redeemRelease(code: string, attendant: string): Release | null {
  const store = readStore();
  const release = store.releases.find((r) => r.code === code.toUpperCase());
  if (!release) return null;
  if (release.redeemedAt) return release;
  release.redeemedAt = new Date().toISOString();
  release.redeemedBy = attendant;
  const impound = store.impounds.find((i) => i.id === release.impoundId);
  if (impound) impound.status = "released";
  writeStore(store);
  return release;
}

export function createPendingPickup(p: PendingPickup): void {
  const store = readStore();
  // Cap the pending list to keep the JSON store manageable between resets.
  store.pending = [...store.pending.slice(-20), p];
  writeStore(store);
}

export function consumePendingPickup(id: string): PendingPickup | null {
  const store = readStore();
  const idx = store.pending.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const [picked] = store.pending.splice(idx, 1);
  writeStore(store);
  return picked;
}

/** Reset the prototype store back to seed data. Useful between demos. */
export function resetStore(): void {
  const seed = loadSeed();
  writeStore(seed);
}
