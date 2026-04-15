"use client";

import { useState } from "react";

export default function DocThumb({ label, src }: { label: string; src: string }) {
  const [open, setOpen] = useState(false);

  if (!src) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-valor-steel">
        <div className="font-semibold text-valor-navy">{label}</div>
        <div className="mt-2">Not provided</div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-left"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className="h-32 w-full object-cover transition group-hover:opacity-90"
        />
        <div className="flex items-center justify-between px-2 py-1 text-xs">
          <span className="font-semibold text-valor-navy">{label}</span>
          <span className="text-valor-steel">Tap to zoom</span>
        </div>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${label} full size`}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={label}
            className="max-h-full max-w-full rounded shadow-2xl"
          />
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-valor-navy shadow"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
