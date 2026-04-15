"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AttendantHome() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,}$/.test(normalized)) {
      setError("Code format looks wrong.");
      return;
    }
    const params = new URLSearchParams({ code: normalized });
    if (pin) params.set("pin", pin);
    router.push(`/attendant/verify?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-xl font-bold">Attendant console</h1>
        <p className="mt-2 text-sm text-valor-steel">
          Scan the customer&rsquo;s QR code with your device camera, or type in the 8-character
          release code.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="code" className="label">
              Release code
            </label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input font-mono uppercase tracking-widest"
              placeholder="ABCD-1234"
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="pin" className="label">
              Attendant PIN
            </label>
            <input
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary w-full justify-center">
            Verify release
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
          How scanning works
        </h2>
        <p className="mt-2 text-sm text-valor-steel">
          QR codes issued to customers link directly to this verification page with the code
          embedded &mdash; open your phone&rsquo;s camera, point at the customer&rsquo;s screen,
          and tap the notification.
        </p>
      </div>
    </div>
  );
}
