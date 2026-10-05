import assert from "node:assert/strict";
import test from "node:test";
import {
  adminResetAuthorized,
  attendantPin,
  pinMatches,
  rateLimitStatus,
  recordRateLimitFailure,
  unpaidDemoReleaseAllowed,
} from "./security";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function requestFrom(host: string): Request {
  return new Request("http://localhost/api/checkout", { headers: { host } });
}

test("admin reset is disabled until a secret is configured", () => {
  withEnv({ ADMIN_RESET_SECRET: undefined }, () => {
    assert.equal(adminResetAuthorized(null), false);
    assert.equal(adminResetAuthorized("anything"), false);
  });
});

test("admin reset accepts only the configured secret", () => {
  withEnv({ ADMIN_RESET_SECRET: "reset-secret" }, () => {
    assert.equal(adminResetAuthorized("reset-secret"), true);
    assert.equal(adminResetAuthorized("reset-secreT"), false);
    assert.equal(adminResetAuthorized(null), false);
    assert.equal(adminResetAuthorized(""), false);
  });
});

test("attendant PIN has no default", () => {
  withEnv({ ATTENDANT_PIN: undefined }, () => {
    assert.equal(attendantPin(), null);
    assert.equal(pinMatches("8421"), false);
    assert.equal(pinMatches(""), false);
  });
});

test("attendant PIN matches only the env value", () => {
  withEnv({ ATTENDANT_PIN: "  4491  " }, () => {
    assert.equal(attendantPin(), "4491");
    assert.equal(pinMatches("4491"), true);
    assert.equal(pinMatches("8421"), false);
  });
});

test("unpaid demo releases are refused unless loopback dev", () => {
  withEnv(
    {
      STRIPE_SECRET_KEY: undefined,
      VERCEL: undefined,
      NODE_ENV: "development",
      NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    },
    () => {
      assert.equal(unpaidDemoReleaseAllowed(requestFrom("localhost:3000")), true);
      assert.equal(unpaidDemoReleaseAllowed(requestFrom("127.0.0.1:3000")), true);
      assert.equal(unpaidDemoReleaseAllowed(requestFrom("192.168.1.47:3000")), false);
      assert.equal(unpaidDemoReleaseAllowed(requestFrom("pickup.example.com")), false);
    },
  );

  withEnv(
    {
      STRIPE_SECRET_KEY: undefined,
      VERCEL: undefined,
      NODE_ENV: "production",
      NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    },
    () => {
      assert.equal(unpaidDemoReleaseAllowed(requestFrom("localhost:3000")), false);
    },
  );

  withEnv(
    {
      STRIPE_SECRET_KEY: undefined,
      VERCEL: "1",
      NODE_ENV: "development",
      NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    },
    () => {
      assert.equal(unpaidDemoReleaseAllowed(requestFrom("localhost:3000")), false);
    },
  );

  withEnv(
    {
      STRIPE_SECRET_KEY: undefined,
      VERCEL: undefined,
      NODE_ENV: "development",
      NEXT_PUBLIC_BASE_URL: "https://valor-pickup.vercel.app",
    },
    () => {
      assert.equal(unpaidDemoReleaseAllowed(requestFrom("localhost:3000")), false);
    },
  );

  withEnv(
    {
      STRIPE_SECRET_KEY: "sk_test_example",
      VERCEL: undefined,
      NODE_ENV: "development",
      NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    },
    () => {
      assert.equal(unpaidDemoReleaseAllowed(requestFrom("localhost:3000")), false);
    },
  );
});

test("PIN attempts are rate limited", () => {
  const key = `test-pin-${Date.now()}`;
  const windowMs = 60_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimitStatus(key, 5, windowMs).blocked, false);
    recordRateLimitFailure(key, windowMs);
  }
  const blocked = rateLimitStatus(key, 5, windowMs);
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.retryAfterSec > 0);
});
