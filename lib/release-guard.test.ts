import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRelease, findActiveRelease, redeemRelease, resetStore } from "./db";
import type { Release } from "./types";

const STORE_PATH = path.join(process.cwd(), "data", "store.json");

function sample(code: string, impoundId = "IMP-24081"): Release {
  return {
    code,
    impoundId,
    customerName: "Ada Lovelace",
    customerPhone: "7035550100",
    docs: { photoId: "data:image/jpeg,abc", ownership: "data:image/jpeg,def" },
    amountPaidCents: 1000,
    paidAt: new Date().toISOString(),
    issuedAt: new Date().toISOString(),
    redeemedAt: null,
    redeemedBy: null,
    stripeSessionId: null,
    demo: true,
  };
}

test("one active release per impound; redeem rejects an already released vehicle", async (t) => {
  if (process.env.KV_REST_API_URL) {
    t.skip("file-store assertions do not run against Vercel KV");
    return;
  }
  fs.rmSync(STORE_PATH, { force: true });
  await resetStore();

  assert.equal(await createRelease(sample("ABCD-2345")), "created");
  assert.ok(await findActiveRelease("IMP-24081"));
  assert.equal(await createRelease(sample("EFGH-6789")), "active_exists");

  const redeemed = await redeemRelease("ABCD-2345", "badge-7");
  assert.equal(redeemed.status, "redeemed");
  assert.equal((await redeemRelease("ABCD-2345", "badge-7")).status, "already_released");
  assert.equal(await findActiveRelease("IMP-24081"), null);
  assert.equal(await createRelease(sample("WXYZ-2345")), "already_released");

  const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as { releases: Release[] };
  raw.releases.push(sample("QRST-2345"));
  fs.writeFileSync(STORE_PATH, JSON.stringify(raw));
  assert.equal((await redeemRelease("QRST-2345", "badge-7")).status, "already_released");

  fs.rmSync(STORE_PATH, { force: true });
});
