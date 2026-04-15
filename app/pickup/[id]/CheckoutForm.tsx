"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { compressImageToDataUrl } from "@/lib/image";

type Props = { impoundId: string; total: number };
type DocKey = "photoId" | "ownership" | "insurance";

const DOC_META: Record<DocKey, { label: string; help: string }> = {
  photoId: {
    label: "Government-issued photo ID",
    help: "Driver's license, passport, or state ID. Take a clear photo of the front.",
  },
  ownership: {
    label: "Proof of ownership",
    help: "Vehicle title or current registration. Make sure the VIN is legible.",
  },
  insurance: {
    label: "Proof of insurance",
    help: "Insurance card or declarations page showing an active policy.",
  },
};

export default function CheckoutForm({ impoundId, total }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<DocKey, string>>({
    photoId: "",
    ownership: "",
    insurance: "",
  });
  const [docProgress, setDocProgress] = useState<Record<DocKey, string>>({
    photoId: "",
    ownership: "",
    insurance: "",
  });

  async function onPick(key: DocKey, file: File | null) {
    if (!file) return;
    setDocProgress((p) => ({ ...p, [key]: "Compressing\u2026" }));
    setError(null);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setDocs((d) => ({ ...d, [key]: dataUrl }));
      const kb = Math.round(((dataUrl.length * 3) / 4) / 1024);
      setDocProgress((p) => ({ ...p, [key]: `Ready (${kb} KB)` }));
    } catch (err) {
      setDocProgress((p) => ({ ...p, [key]: "" }));
      setError("Couldn't process that image. Try a JPG or PNG.");
    }
  }

  const allDocsUploaded = docs.photoId && docs.ownership && docs.insurance;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!allDocsUploaded) {
      setError("Please upload all three required documents.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impoundId, name, phone, docs }),
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
    <form onSubmit={onSubmit} className="card space-y-6">
      <section className="space-y-4">
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
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
            Required documents
          </h2>
          <p className="mt-1 text-xs text-valor-steel">
            Photos only. Files are compressed locally before upload and are only shown to
            the lot attendant who releases your vehicle.
          </p>
        </div>
        {(Object.keys(DOC_META) as DocKey[]).map((key) => (
          <div key={key} className="rounded-md border border-slate-200 p-3">
            <label htmlFor={`doc-${key}`} className="label">
              {DOC_META[key].label}
            </label>
            <p className="mt-1 text-xs text-valor-steel">{DOC_META[key].help}</p>
            <input
              id={`doc-${key}`}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onPick(key, e.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm"
              required
            />
            {docs[key] && (
              <div className="mt-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={docs[key]}
                  alt={`${DOC_META[key].label} preview`}
                  className="h-16 w-24 rounded border border-slate-200 object-cover"
                />
                <span className="text-xs text-emerald-700">{docProgress[key]}</span>
              </div>
            )}
            {!docs[key] && docProgress[key] && (
              <p className="mt-1 text-xs text-valor-steel">{docProgress[key]}</p>
            )}
          </div>
        ))}
      </section>

      <label className="flex items-start gap-2 text-sm text-valor-steel">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-1"
          required
        />
        <span>
          I acknowledge the fees above, that I am authorized to take possession of this
          vehicle, and that the documents I uploaded are true and current.
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading || !agree || !allDocsUploaded}
        className="btn-primary w-full justify-center"
      >
        {loading ? "Starting checkout\u2026" : `Pay ${totalUsd} and get release code`}
      </button>
    </form>
  );
}
