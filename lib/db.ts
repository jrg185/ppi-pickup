import fs from "node:fs";
import path from "node:path";
import type { Impound, Release } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const SEED_PATH = path.join(DATA_DIR, "impounds.json");

type Store = {
  impounds: Impound[];
  releases: Release[];
};

function loadSeed(): Store {
  const raw = fs.readFileSync(SEED_PATH, "utf8");
  const parsed = JSON.parse(raw) as { impounds: Impound[] };
  return { impounds: parsed.impounds, releases: [] };
}

function readStore(): Store {
  if (!fs.existsSync(STORE_PATH)) {
    const seed = loadSeed();
    fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
  const raw = fs.readFileSync(STORE_PATH, "utf8");
  return JSON.parse(raw) as Store;
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

/** Reset the prototype store back to seed data. Useful between demos. */
export function resetStore(): void {
  const seed = loadSeed();
  writeStore(seed);
}
