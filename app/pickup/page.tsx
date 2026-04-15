"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PickupLookup() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to locate that vehicle.");
        return;
      }
      router.push(`/pickup/${data.impoundId}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1 className="text-xl font-bold">Step 1 &middot; Locate your vehicle</h1>
      <p className="mt-2 text-sm text-valor-steel">
        Enter your license plate, VIN, or the impound number from the notice on your
        windshield or door.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="q" className="label">
            Plate / VIN / Impound #
          </label>
          <input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input font-mono uppercase"
            autoFocus
            required
            placeholder="7KLM342"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Looking up\u2026" : "Find my vehicle"}
        </button>
      </form>
    </div>
  );
}
