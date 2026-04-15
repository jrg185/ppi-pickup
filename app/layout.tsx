import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Valor Vehicle Pickup Portal",
  description: "Self-service pickup for impounded vehicles",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-valor-navy font-bold text-valor-accent">
                V
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-valor-navy">Valor</div>
                <div className="text-xs text-valor-steel">Vehicle Pickup Portal</div>
              </div>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/pickup" className="text-valor-steel hover:text-valor-navy">
                Pick up
              </Link>
              <Link href="/attendant" className="text-valor-steel hover:text-valor-navy">
                Attendant
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-valor-steel">
          Prototype only &mdash; not for production use. Data is mock.
        </footer>
      </body>
    </html>
  );
}
