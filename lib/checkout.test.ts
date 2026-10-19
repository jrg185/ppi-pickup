import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { POST } from "../app/api/checkout/route";
import {
  CHECKOUT_SESSION_TTL_SEC,
  finalizePaidCheckout,
  type PaidCheckoutSessionParams,
  type PaidSessionSnapshot,
} from "./checkout";
import {
  findActiveRelease,
  getCheckoutLock,
  getRelease,
  resetStore,
} from "./db";
import { CHECKOUT_IMPOUND_LIMIT, resetRateLimitsForTests } from "./security";
import { setCheckoutSessionFactoryForTests } from "./stripe";
import type { DocumentUploads } from "./types";

const STORE_PATH = path.join(process.cwd(), "data", "store.json");

const docs: DocumentUploads = {
  photoId: "data:image/jpeg,abc",
  ownership: "data:image/jpeg,def",
};

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function checkoutRequest(headers: Record<string, string>, impoundId = "IMP-24081"): Request {
  return new Request("http://pickup.example.com/api/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "pickup.example.com",
      "x-forwarded-for": "203.0.113.50",
      ...headers,
    },
    body: JSON.stringify({
      impoundId,
      name: "Ada Lovelace",
      phone: "7035550100",
      docs,
    }),
  });
}

function snapshot(partial: Partial<PaidSessionSnapshot> & Pick<PaidSessionSnapshot, "id">): PaidSessionSnapshot {
  return {
    paymentStatus: "unpaid",
    amountTotal: 25000,
    impoundId: "IMP-24082",
    pickupId: "pickup_test",
    paymentIntent: null,
    ...partial,
  };
}

test("checkout does not lock a vehicle before payment and ignores forwarded host", async (t) => {
  if (process.env.KV_REST_API_URL) {
    t.skip("file-store assertions do not run against Vercel KV");
    return;
  }

  await t.test("spoofed X-Forwarded-Host does not mint an unpaid release", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    resetRateLimitsForTests();
    await withEnv(
      {
        STRIPE_SECRET_KEY: undefined,
        VERCEL: undefined,
        NODE_ENV: "development",
        NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
        ALLOW_UNPAID_DEMO: undefined,
      },
      async () => {
        const res = await POST(
          checkoutRequest({
            host: "pickup.example.com",
            "x-forwarded-host": "localhost",
          }),
        );
        assert.equal(res.status, 403);
        const body = (await res.json()) as { code?: string };
        assert.equal(body.code, undefined);
        assert.equal(await getCheckoutLock("IMP-24081"), null);
        assert.equal(await findActiveRelease("IMP-24081"), null);
      },
    );
  });

  await t.test("explicit unpaid demo flag mints a code without taking a lock", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    resetRateLimitsForTests();
    await withEnv(
      {
        STRIPE_SECRET_KEY: undefined,
        VERCEL: undefined,
        NODE_ENV: "development",
        NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
        ALLOW_UNPAID_DEMO: "1",
      },
      async () => {
        const res = await POST(
          checkoutRequest({
            host: "pickup.example.com",
            "x-forwarded-host": "localhost",
            "x-forwarded-for": "203.0.113.51",
          }),
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as { code: string };
        assert.match(body.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        assert.equal(await getCheckoutLock("IMP-24081"), null);
        const release = await getRelease(body.code);
        assert.equal(release?.demo, true);
        assert.equal(release?.impoundId, "IMP-24081");
      },
    );
  });

  await t.test("two unpaid stripe sessions do not take an exclusive lock", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    resetRateLimitsForTests();
    const created: PaidCheckoutSessionParams[] = [];
    setCheckoutSessionFactoryForTests(async (params) => {
      created.push(params as PaidCheckoutSessionParams);
      return { url: `https://checkout.stripe.test/${created.length}` };
    });
    try {
      await withEnv(
        {
          STRIPE_SECRET_KEY: "sk_test_example",
          VERCEL: undefined,
          NODE_ENV: "development",
          NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
          ALLOW_UNPAID_DEMO: undefined,
        },
        async () => {
          const first = await POST(
            checkoutRequest({ "x-forwarded-for": "203.0.113.61" }, "IMP-24082"),
          );
          const second = await POST(
            checkoutRequest({ "x-forwarded-for": "203.0.113.62" }, "IMP-24082"),
          );
          assert.equal(first.status, 200);
          assert.equal(second.status, 200);
          assert.equal(((await first.json()) as { url: string }).url, "https://checkout.stripe.test/1");
          assert.equal(((await second.json()) as { url: string }).url, "https://checkout.stripe.test/2");
          assert.equal(await getCheckoutLock("IMP-24082"), null);
          assert.equal(await findActiveRelease("IMP-24082"), null);
          assert.equal(created.length, 2);
          for (const params of created) {
            assert.equal(params.payment_intent_data.capture_method, "manual");
            const lifetime = params.expires_at - Math.floor(Date.now() / 1000);
            assert.ok(lifetime >= 30 * 60);
            assert.ok(lifetime <= CHECKOUT_SESSION_TTL_SEC + 5);
          }
          assert.notEqual(created[0].metadata.pickupId, created[1].metadata.pickupId);

          const calls = { capture: 0, voidAuthorization: 0, refund: 0 };
          const actions = {
            capture: async () => {
              calls.capture += 1;
            },
            voidAuthorization: async () => {
              calls.voidAuthorization += 1;
            },
            refund: async () => {
              calls.refund += 1;
            },
          };

          const unpaid = await finalizePaidCheckout(
            snapshot({
              id: "cs_unpaid",
              impoundId: "IMP-24082",
              pickupId: created[0].metadata.pickupId,
              paymentStatus: "unpaid",
              paymentIntent: { id: "pi_unpaid", status: "open", amount: 25000 },
            }),
            actions,
          );
          assert.equal(unpaid, null);
          assert.equal(await getCheckoutLock("IMP-24082"), null);
          assert.equal(calls.capture, 0);
          assert.equal(calls.voidAuthorization, 0);

          const winner = await finalizePaidCheckout(
            snapshot({
              id: "cs_winner",
              impoundId: "IMP-24082",
              pickupId: created[0].metadata.pickupId,
              paymentStatus: "unpaid",
              paymentIntent: { id: "pi_winner", status: "requires_capture", amount: 25000 },
            }),
            actions,
          );
          assert.ok(winner);
          assert.equal(calls.capture, 1);
          assert.equal(await getCheckoutLock("IMP-24082"), null);
          assert.equal((await getRelease(winner!))?.stripeSessionId, "cs_winner");

          const replay = await finalizePaidCheckout(
            snapshot({
              id: "cs_winner",
              impoundId: "IMP-24082",
              pickupId: created[0].metadata.pickupId,
              paymentStatus: "paid",
              paymentIntent: { id: "pi_winner", status: "succeeded", amount: 25000 },
            }),
            actions,
          );
          assert.equal(replay, winner);
          assert.equal(calls.capture, 1);
          assert.equal(calls.voidAuthorization, 0);
          assert.equal(calls.refund, 0);

          const loser = await finalizePaidCheckout(
            snapshot({
              id: "cs_loser",
              impoundId: "IMP-24082",
              pickupId: created[1].metadata.pickupId,
              paymentStatus: "unpaid",
              paymentIntent: { id: "pi_loser", status: "requires_capture", amount: 25000 },
            }),
            actions,
          );
          assert.equal(loser, null);
          assert.equal(calls.voidAuthorization, 1);
          assert.equal(calls.refund, 0);
          assert.equal((await findActiveRelease("IMP-24082"))?.code, winner);
          assert.equal(await getCheckoutLock("IMP-24082"), null);

          const again = await POST(
            checkoutRequest({ "x-forwarded-for": "203.0.113.63" }, "IMP-24082"),
          );
          assert.equal(again.status, 409);
        },
      );
    } finally {
      setCheckoutSessionFactoryForTests(null);
    }
  });

  await t.test("checkout attempts are rate limited without locking the impound", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    resetRateLimitsForTests();
    setCheckoutSessionFactoryForTests(async () => ({ url: "https://checkout.stripe.test/limited" }));
    try {
      await withEnv(
        {
          STRIPE_SECRET_KEY: "sk_test_example",
          VERCEL: undefined,
          NODE_ENV: "development",
          NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
          ALLOW_UNPAID_DEMO: undefined,
        },
        async () => {
          for (let i = 0; i < CHECKOUT_IMPOUND_LIMIT; i++) {
            const res = await POST(
              checkoutRequest({ "x-forwarded-for": `203.0.113.${i + 1}` }, "IMP-24083"),
            );
            assert.equal(res.status, 200);
          }
          const blocked = await POST(
            checkoutRequest({ "x-forwarded-for": "198.51.100.9" }, "IMP-24083"),
          );
          assert.equal(blocked.status, 429);
          assert.ok(blocked.headers.get("Retry-After"));
          assert.equal(await getCheckoutLock("IMP-24083"), null);
          assert.equal(await findActiveRelease("IMP-24083"), null);
        },
      );
    } finally {
      setCheckoutSessionFactoryForTests(null);
    }
  });

  fs.rmSync(STORE_PATH, { force: true });
});
