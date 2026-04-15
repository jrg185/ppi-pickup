"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RedeemButton({ code, pin }: { code: string; pin: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attendant, setAttendant] = useState("");

  async function onClick() {
    if (!attendant.trim()) {
      setError("Enter your name or badge number.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/release/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pin, attendant }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Redemption failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div>
        <label htmlFor="attendant" className="label">
          Your name or badge #
        </label>
        <input
          id="attendant"
          value={attendant}
          onChange={(e) => setAttendant(e.target.value)}
          className="input"
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={onClick}
        disabled={loading}
        className="btn-primary w-full justify-center"
      >
        {loading ? "Releasing\u2026" : "Release vehicle"}
      </button>
    </div>
  );
}
