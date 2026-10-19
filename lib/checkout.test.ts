import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { POST } from "../app/api/checkout/route";
import {
  CHECKOUT_SESSION_TTL_SEC,
  finalizePaidCheckout,
  setFinalizeBarrierForTests,
  type PaidCheckoutSessionParams,
  type PaidSessionSnapshot,
} from "./checkout";
import {
  PENDING_PICKUP_TTL_SEC,
  createPendingPickup,
  findActiveRelease,
  getCheckoutLock,
  getPendingPickup,
  getRelease,
  reserveCheckout,
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

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function tally() {
  const calls = { capture: 0, voidAuthorization: 0, refund: 0 };
  return {
    calls,
    actions: {
      capture: async () => {
        calls.capture += 1;
      },
      voidAuthorization: async () => {
        calls.voidAuthorization += 1;
      },
      refund: async () => {
        calls.refund += 1;
      },
    },
  };
}

async function seedPending(pickupId: string, impoundId = "IMP-24082"): Promise<void> {
  await createPendingPickup({
    id: pickupId,
    impoundId,
    customerName: "Ada Lovelace",
    customerPhone: "7035550100",
    docs,
    createdAt: new Date().toISOString(),
  });
}

test("overlapping finalize of one paid session does not reverse that charge", async (t) => {
  if (process.env.KV_REST_API_URL) {
    t.skip("file-store assertions do not run against Vercel KV");
    return;
  }

  const impoundId = "IMP-24082";
  const pickupId = "pickup_overlap";

  t.after(() => {
    setFinalizeBarrierForTests(null);
    fs.rmSync(STORE_PATH, { force: true });
  });

  await t.test("a later visit sees the release and does not refund", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    setFinalizeBarrierForTests(null);
    await seedPending(pickupId);

    const releaseCapture = defer();
    const entered = defer();
    const { calls, actions } = tally();
    actions.capture = async () => {
      calls.capture += 1;
      entered.resolve();
      await releaseCapture.promise;
    };

    const winner = finalizePaidCheckout(
      snapshot({
        id: "cs_overlap",
        impoundId,
        pickupId,
        paymentIntent: { id: "pi_overlap", status: "requires_capture", amount: 25000 },
      }),
      actions,
    );
    await entered.promise;

    const loserReady = defer();
    setFinalizeBarrierForTests(async () => {
      loserReady.resolve();
      await winner;
    });
    const loser = finalizePaidCheckout(
      snapshot({
        id: "cs_overlap",
        impoundId,
        pickupId,
        paymentStatus: "paid",
        paymentIntent: { id: "pi_overlap", status: "succeeded", amount: 25000 },
      }),
      actions,
    );
    await loserReady.promise;
    releaseCapture.resolve();

    const code = await winner;
    assert.equal(await loser, code);
    assert.ok(code);
    assert.equal(calls.refund, 0);
    assert.equal(calls.voidAuthorization, 0);
    assert.equal((await getRelease(code!))?.stripeSessionId, "cs_overlap");
    assert.equal(await getCheckoutLock(impoundId), null);
  });

  await t.test("a visit that reserved first does not void after the pending row is consumed", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    setFinalizeBarrierForTests(null);
    await seedPending(pickupId);

    const releaseCapture = defer();
    const entered = defer();
    const { calls, actions } = tally();
    actions.capture = async () => {
      calls.capture += 1;
      entered.resolve();
      await releaseCapture.promise;
    };

    const winner = finalizePaidCheckout(
      snapshot({
        id: "cs_overlap",
        impoundId,
        pickupId,
        paymentIntent: { id: "pi_overlap", status: "requires_capture", amount: 25000 },
      }),
      actions,
    );
    await entered.promise;

    let pauses = 0;
    const loserReady = defer();
    setFinalizeBarrierForTests(async () => {
      pauses += 1;
      if (pauses < 2) return;
      loserReady.resolve();
      await winner;
    });
    const loser = finalizePaidCheckout(
      snapshot({
        id: "cs_overlap",
        impoundId,
        pickupId,
        paymentStatus: "paid",
        paymentIntent: { id: "pi_overlap", status: "succeeded", amount: 25000 },
      }),
      actions,
    );
    await loserReady.promise;
    releaseCapture.resolve();

    const code = await winner;
    assert.equal(await loser, code);
    assert.ok(code);
    assert.equal(calls.capture, 1);
    assert.equal(calls.refund, 0);
    assert.equal(calls.voidAuthorization, 0);
    assert.equal(await getCheckoutLock(impoundId), null);
  });

  await t.test("a sibling capture that is already done does not drop the checkout lock", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    setFinalizeBarrierForTests(null);
    await seedPending(pickupId);

    const releaseFirst = defer();
    const releaseSecond = defer();
    const firstEntered = defer();
    const secondEntered = defer();
    const { calls, actions } = tally();
    let captures = 0;
    actions.capture = async () => {
      calls.capture += 1;
      captures += 1;
      if (captures === 1) {
        firstEntered.resolve();
        await releaseFirst.promise;
        return;
      }
      secondEntered.resolve();
      await releaseSecond.promise;
      const err = new Error(
        "This PaymentIntent could not be captured because it has a status of succeeded. Only a PaymentIntent with one of the following statuses may be captured: requires_capture.",
      ) as Error & { code: string; payment_intent: { status: string } };
      err.code = "payment_intent_unexpected_state";
      err.payment_intent = { status: "succeeded" };
      throw err;
    };

    const session = snapshot({
      id: "cs_overlap",
      impoundId,
      pickupId,
      paymentIntent: { id: "pi_overlap", status: "requires_capture", amount: 25000 },
    });
    const first = finalizePaidCheckout(session, actions);
    const second = finalizePaidCheckout(session, actions);
    await firstEntered.promise;
    await secondEntered.promise;
    releaseSecond.resolve();
    await Promise.race([first, second]);

    assert.equal(await getCheckoutLock(impoundId), pickupId);
    assert.equal(await reserveCheckout(impoundId, "pickup_other"), "locked");
    assert.equal(calls.refund, 0);
    assert.equal(calls.voidAuthorization, 0);

    releaseFirst.resolve();
    const codes = (await Promise.all([first, second])).filter(
      (code): code is string => Boolean(code),
    );
    assert.equal(codes.length, 1);
    assert.equal(calls.refund, 0);
    assert.equal(calls.voidAuthorization, 0);
    assert.equal(await getCheckoutLock(impoundId), null);
    assert.equal((await findActiveRelease(impoundId))?.stripeSessionId, "cs_overlap");
  });

  await t.test("a failed capture still releases the lock", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    setFinalizeBarrierForTests(null);
    await seedPending(pickupId);
    const { calls, actions } = tally();
    actions.capture = async () => {
      calls.capture += 1;
      const err = new Error(
        "This PaymentIntent could not be captured because it has a status of canceled.",
      ) as Error & { code: string; payment_intent: { status: string } };
      err.code = "payment_intent_unexpected_state";
      err.payment_intent = { status: "canceled" };
      throw err;
    };
    const code = await finalizePaidCheckout(
      snapshot({
        id: "cs_cancel",
        impoundId,
        pickupId,
        paymentIntent: { id: "pi_cancel", status: "requires_capture", amount: 25000 },
      }),
      actions,
    );
    assert.equal(code, null);
    assert.equal(calls.refund, 0);
    assert.equal(calls.voidAuthorization, 0);
    assert.equal(await getCheckoutLock(impoundId), null);
    assert.equal(await findActiveRelease(impoundId), null);
  });

  fs.rmSync(STORE_PATH, { force: true });
});

test("file store keeps in-flight pending pickups", async (t) => {
  if (process.env.KV_REST_API_URL) {
    t.skip("file-store assertions do not run against Vercel KV");
    return;
  }

  t.after(() => {
    fs.rmSync(STORE_PATH, { force: true });
  });

  await t.test("more than 20 fresh checkouts stay readable and can be finalized", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    const impounds = ["IMP-24081", "IMP-24082", "IMP-24083"];
    const ids: string[] = [];
    for (let i = 0; i < 24; i++) {
      const id = `pickup_cap_${i}`;
      ids.push(id);
      await createPendingPickup({
        id,
        impoundId: impounds[i % impounds.length],
        customerName: "Ada Lovelace",
        customerPhone: "7035550100",
        docs,
        createdAt: new Date().toISOString(),
      });
    }
    assert.equal((await getPendingPickup(ids[0]))?.id, ids[0]);
    assert.equal((await getPendingPickup(ids[23]))?.id, ids[23]);

    const { calls, actions } = tally();
    const code = await finalizePaidCheckout(
      snapshot({
        id: "cs_early",
        impoundId: "IMP-24081",
        pickupId: ids[0],
        paymentIntent: { id: "pi_early", status: "requires_capture", amount: 25000 },
      }),
      actions,
    );
    assert.ok(code);
    assert.equal(calls.capture, 1);
    assert.equal(calls.voidAuthorization, 0);
    assert.equal(calls.refund, 0);
    assert.equal((await getRelease(code!))?.stripeSessionId, "cs_early");
    assert.equal((await getPendingPickup(ids[3]))?.id, ids[3]);
  });

  await t.test("expired pending pickups are dropped instead of crowding out fresh ones", async () => {
    fs.rmSync(STORE_PATH, { force: true });
    await resetStore();
    await createPendingPickup({
      id: "pickup_stale",
      impoundId: "IMP-24081",
      customerName: "Ada Lovelace",
      customerPhone: "7035550100",
      docs,
      createdAt: new Date().toISOString(),
    });
    const stored = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as {
      pending: Array<{ id: string; createdAt: string }>;
    };
    stored.pending[0].createdAt = new Date(
      Date.now() - (PENDING_PICKUP_TTL_SEC + 60) * 1000,
    ).toISOString();
    fs.writeFileSync(STORE_PATH, JSON.stringify(stored));
    assert.equal(await getPendingPickup("pickup_stale"), null);

    await createPendingPickup({
      id: "pickup_fresh",
      impoundId: "IMP-24081",
      customerName: "Ada Lovelace",
      customerPhone: "7035550100",
      docs,
      createdAt: new Date().toISOString(),
    });
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as {
      pending: Array<{ id: string }>;
    };
    assert.equal(
      raw.pending.some((row) => row.id === "pickup_stale"),
      false,
    );
    assert.equal((await getPendingPickup("pickup_fresh"))?.id, "pickup_fresh");
  });

  fs.rmSync(STORE_PATH, { force: true });
});
