/**
 * Storage layer. Two backends:
 *
 *   1. Vercel KV (used when KV_REST_API_URL is set, i.e. on Vercel)
 *   2. Local JSON file at data/store.json (used for local dev)
 *
 * The public API is identical across backends. All calls are async.
 *
 * The KV backend self-seeds from data/impounds.json on first access, so a
 * fresh deploy has the three demo vehicles available without any extra step.
 *
 * Release documents (photo ID and ownership) are stored in a second KV key
 * per release to keep any single value under the 1 MB Upstash cap.
 */

import fs from "node:fs";
import path from "node:path";
import { kv } from "@vercel/kv";
import type {
  DocumentUploads,
  Impound,
  PendingPickup,
  Release,
} from "./types";

const SEED_PATH = path.join(process.cwd(), "data", "impounds.json");
const STORE_PATH = path.join(process.cwd(), "data", "store.json");

function useKV(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

function readSeed(): Impound[] {
  const raw = fs.readFileSync(SEED_PATH, "utf8");
  return (JSON.parse(raw) as { impounds: Impound[] }).impounds;
}

// ---------- File backend ----------

type FileStore = {
  impounds: Impound[];
  releases: Release[];
  pending: PendingPickup[];
};

function fileRead(): FileStore {
  if (!fs.existsSync(STORE_PATH)) {
    const s: FileStore = { impounds: readSeed(), releases: [], pending: [] };
    fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2));
    return s;
  }
  const raw = fs.readFileSync(STORE_PATH, "utf8");
  const p = JSON.parse(raw) as Partial<FileStore>;
  return {
    impounds: p.impounds ?? [],
    releases: p.releases ?? [],
    pending: p.pending ?? [],
  };
}

function fileWrite(s: FileStore): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2));
}

// ---------- KV backend ----------

const K = {
  seeded: "valor:seeded",
  impounds: "valor:impounds",
  release: (code: string) => `valor:release:${code}`,
  releaseDocs: (code: string) => `valor:release_docs:${code}`,
  releaseBySession: (sid: string) => `valor:release_by_session:${sid}`,
  releaseCodes: "valor:release_codes",
  activeRelease: (impoundId: string) => `valor:active_release:${impoundId}`,
  pending: (id: string) => `valor:pending:${id}`,
  pendingIds: "valor:pending_ids",
};

async function kvEnsureSeeded(): Promise<void> {
  const seeded = await kv.get<boolean>(K.seeded);
  if (seeded) return;
  await kv.set(K.impounds, readSeed());
  await kv.set(K.seeded, true);
}

async function kvGetImpounds(): Promise<Impound[]> {
  await kvEnsureSeeded();
  return (await kv.get<Impound[]>(K.impounds)) ?? [];
}

async function kvSetImpounds(list: Impound[]): Promise<void> {
  await kv.set(K.impounds, list);
}

type ReleaseMeta = Omit<Release, "docs">;

async function kvStoreRelease(release: Release): Promise<void> {
  const { docs, ...meta } = release;
  await kv.set(K.release(release.code), meta);
  await kv.set(K.releaseDocs(release.code), docs);
  if (release.stripeSessionId) {
    await kv.set(K.releaseBySession(release.stripeSessionId), release.code);
  }
  await kv.sadd(K.releaseCodes, release.code);
}

async function kvLoadRelease(code: string): Promise<Release | null> {
  const meta = await kv.get<ReleaseMeta>(K.release(code));
  if (!meta) return null;
  const docs =
    (await kv.get<DocumentUploads>(K.releaseDocs(code))) ??
    ({ photoId: "", ownership: "" } satisfies DocumentUploads);
  return { ...meta, docs };
}

async function kvDeleteRelease(code: string): Promise<void> {
  const meta = await kv.get<ReleaseMeta>(K.release(code));
  if (meta?.impoundId) {
    const active = await kv.get<string>(K.activeRelease(meta.impoundId));
    if (!active || active === code) await kv.del(K.activeRelease(meta.impoundId));
  }
  if (meta?.stripeSessionId) await kv.del(K.releaseBySession(meta.stripeSessionId));
  await kv.del(K.release(code), K.releaseDocs(code));
  await kv.srem(K.releaseCodes, code);
}

/** Unredeemed release for an impound, if one exists. */
async function kvFindActive(impoundId: string): Promise<Release | null> {
  const indexed = await kv.get<string>(K.activeRelease(impoundId));
  if (indexed) {
    const indexedRelease = await kvLoadRelease(indexed);
    if (
      indexedRelease &&
      !indexedRelease.redeemedAt &&
      indexedRelease.impoundId === impoundId
    ) {
      return indexedRelease;
    }
  }
  const codes = ((await kv.smembers(K.releaseCodes)) as string[] | null) ?? [];
  for (const code of codes) {
    if (code === indexed) continue;
    const meta = await kv.get<ReleaseMeta>(K.release(code));
    if (meta && meta.impoundId === impoundId && !meta.redeemedAt) {
      return kvLoadRelease(code);
    }
  }
  return null;
}

// ---------- Public API ----------

function normalize(s: string): string {
  return s.trim().toUpperCase().replace(/[-\s]/g, "");
}

export async function findImpound(query: string): Promise<Impound | null> {
  const q = normalize(query);
  if (!q) return null;
  const impounds = useKV() ? await kvGetImpounds() : fileRead().impounds;
  return (
    impounds.find((i) => {
      return (
        normalize(i.id) === q ||
        normalize(i.plate) === q ||
        i.vin.toUpperCase() === q
      );
    }) ?? null
  );
}

export async function getImpound(id: string): Promise<Impound | null> {
  const impounds = useKV() ? await kvGetImpounds() : fileRead().impounds;
  return impounds.find((i) => i.id === id) ?? null;
}

export type CreateReleaseResult = "created" | "already_released" | "active_exists";

export async function findActiveRelease(impoundId: string): Promise<Release | null> {
  if (useKV()) return kvFindActive(impoundId);
  const found = fileRead().releases.find(
    (r) => r.impoundId === impoundId && !r.redeemedAt,
  );
  return found ?? null;
}

export async function createRelease(release: Release): Promise<CreateReleaseResult> {
  if (useKV()) return kvCreateRelease(release);
  const s = fileRead();
  const imp = s.impounds.find((i) => i.id === release.impoundId);
  if (!imp || imp.status === "released") return "already_released";
  if (s.releases.some((r) => r.impoundId === release.impoundId && !r.redeemedAt)) {
    return "active_exists";
  }
  s.releases.push(release);
  fileWrite(s);
  return "created";
}

const CLEAR_ACTIVE_IF_VALUE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

async function clearActiveIf(impoundId: string, code: string): Promise<void> {
  await kv.eval(CLEAR_ACTIVE_IF_VALUE, [K.activeRelease(impoundId)], [code]);
}

async function claimActiveRelease(impoundId: string, code: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const claimed = await kv.set(K.activeRelease(impoundId), code, { nx: true });
    if (claimed) return true;
    const holderCode = await kv.get<string>(K.activeRelease(impoundId));
    if (!holderCode) continue;
    const holder = await kvLoadRelease(holderCode);
    if (holder && !holder.redeemedAt) return false;
    await clearActiveIf(impoundId, holderCode);
  }
  return false;
}

async function kvCreateRelease(release: Release): Promise<CreateReleaseResult> {
  const impounds = await kvGetImpounds();
  const imp = impounds.find((i) => i.id === release.impoundId);
  if (!imp || imp.status === "released") return "already_released";

  const existing = await kvFindActive(release.impoundId);
  if (existing) return "active_exists";

  const claimed = await claimActiveRelease(release.impoundId, release.code);
  if (!claimed) return "active_exists";

  try {
    await kvStoreRelease(release);
  } catch (err) {
    await clearActiveIf(release.impoundId, release.code);
    throw err;
  }
  return "created";
}

export async function getRelease(code: string): Promise<Release | null> {
  const key = code.toUpperCase();
  if (useKV()) return kvLoadRelease(key);
  const s = fileRead();
  return s.releases.find((r) => r.code === key) ?? null;
}

export async function getReleaseBySession(
  sessionId: string,
): Promise<Release | null> {
  if (useKV()) {
    const code = await kv.get<string>(K.releaseBySession(sessionId));
    if (!code) return null;
    return kvLoadRelease(code);
  }
  const s = fileRead();
  return s.releases.find((r) => r.stripeSessionId === sessionId) ?? null;
}

export type RedeemResult =
  | { status: "redeemed"; release: Release }
  | { status: "not_found" }
  | { status: "already_released" };

export async function redeemRelease(code: string, attendant: string): Promise<RedeemResult> {
  const key = code.toUpperCase();
  if (useKV()) return kvRedeem(key, attendant);

  const s = fileRead();
  const release = s.releases.find((r) => r.code === key);
  if (!release) return { status: "not_found" };
  if (release.redeemedAt) return { status: "already_released" };
  const imp = s.impounds.find((i) => i.id === release.impoundId);
  if (imp?.status === "released") return { status: "already_released" };
  release.redeemedAt = new Date().toISOString();
  release.redeemedBy = attendant;
  if (imp) imp.status = "released";
  fileWrite(s);
  return { status: "redeemed", release };
}

async function kvRedeem(key: string, attendant: string): Promise<RedeemResult> {
  const release = await kvLoadRelease(key);
  if (!release) return { status: "not_found" };
  if (release.redeemedAt) return { status: "already_released" };
  const impounds = await kvGetImpounds();
  const idx = impounds.findIndex((i) => i.id === release.impoundId);
  if (idx >= 0 && impounds[idx].status === "released") {
    return { status: "already_released" };
  }
  release.redeemedAt = new Date().toISOString();
  release.redeemedBy = attendant;
  const { docs: _docs, ...meta } = release;
  await kv.set(K.release(key), meta);
  if (idx >= 0) {
    impounds[idx] = { ...impounds[idx], status: "released" };
    await kvSetImpounds(impounds);
  }
  await clearActiveIf(release.impoundId, key);
  return { status: "redeemed", release };
}

export async function createPendingPickup(p: PendingPickup): Promise<void> {
  if (useKV()) {
    // Pending pickups should never linger: 1 hour TTL.
    await kv.set(K.pending(p.id), p, { ex: 3600 });
    await kv.sadd(K.pendingIds, p.id);
    return;
  }
  const s = fileRead();
  s.pending = [...s.pending.slice(-20), p];
  fileWrite(s);
}

export async function consumePendingPickup(
  id: string,
): Promise<PendingPickup | null> {
  if (useKV()) {
    const p = await kv.get<PendingPickup>(K.pending(id));
    if (!p) return null;
    await kv.del(K.pending(id));
    await kv.srem(K.pendingIds, id);
    return p;
  }
  const s = fileRead();
  const idx = s.pending.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const [picked] = s.pending.splice(idx, 1);
  fileWrite(s);
  return picked;
}

/** Reset the prototype store back to seed data. Useful between demos. */
export async function resetStore(): Promise<void> {
  if (useKV()) {
    const codes = (await kv.smembers(K.releaseCodes)) as string[] | null;
    if (codes && codes.length > 0) {
      await Promise.all(codes.map((c) => kvDeleteRelease(c)));
    }
    await kv.del(K.releaseCodes);

    const pendingIds = (await kv.smembers(K.pendingIds)) as string[] | null;
    if (pendingIds && pendingIds.length > 0) {
      await Promise.all(pendingIds.map((id) => kv.del(K.pending(id))));
    }
    await kv.del(K.pendingIds);

    // Re-seed impounds from disk (resets any "released" statuses).
    await kv.del(K.seeded);
    await kvEnsureSeeded();
    return;
  }
  fileWrite({ impounds: readSeed(), releases: [], pending: [] });
}
