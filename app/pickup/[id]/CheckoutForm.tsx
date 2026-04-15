"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { impoundId: string; total: number };

export default function CheckoutForm({ impoundId, total }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impoundId, name, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to start checkout.");
        return;
      }
      if (data.url) {
        window.location.href = data.url as string;
      } else if (data.code) {
        router.push(`/pickup/success?code=${encodeURIComponent(data.code)}`);
      } else {
        setError("Unexpected response from server.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const totalUsd = (total / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
        Your information
      </h2>
      <div>
        <label htmlFor="name" className="label">
          Full name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          className="input"
          autoComplete="name"
        />
      </div>
      <div>
        <label htmlFor="phone" className="label">
          Mobile phone
        </label>
        <input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          inputMode="tel"
          pattern="[0-9()+\-\s]{7,}"
          className="input"
          autoComplete="tel"
          placeholder="(703) 555-0142"
        />
        <p className="mt-1 text-xs text-valor-steel">
          We&rsquo;ll text your release QR code to this number.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm text-valor-steel">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-1"
          required
        />
        <span>
          I acknowledge the fees above and that I am authorized to take possession of this
          vehicle.
        </span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading || !agree}
        className="btn-primary w-full justify-center"
      >
        {loading ? "Starting checkout\u2026" : `Pay ${totalUsd} and get release code`}
      </button>
    </form>
  );
}
