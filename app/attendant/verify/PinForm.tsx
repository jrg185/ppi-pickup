"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PinForm({ code }: { code: string }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/attendant/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "PIN rejected.");
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
    <form onSubmit={onSubmit} className="card space-y-4">
      <h1 className="text-xl font-bold">Attendant PIN required</h1>
      <p className="text-sm text-valor-steel">
        Enter the lot attendant PIN to view release details for <b>{code}</b>.
      </p>
      <div>
        <label htmlFor="pin" className="label">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          className="input"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full justify-center"
      >
        {loading ? "Checking\u2026" : "Continue"}
      </button>
    </form>
  );
}
