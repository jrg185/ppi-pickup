import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="card">
        <h1 className="text-2xl font-bold text-valor-navy">Retrieve your vehicle</h1>
        <p className="mt-2 text-sm text-valor-steel">
          If your vehicle was towed from private property by Valor, you can pay fees online
          and receive a QR release code to show the lot attendant. The whole process takes
          about two minutes.
        </p>
        <ol className="mt-4 space-y-2 text-sm text-valor-navy">
          <li>1. Look up your vehicle by license plate or impound number.</li>
          <li>2. Confirm your contact info and pay the fees securely.</li>
          <li>3. Show the QR code at the lot &mdash; the attendant releases your vehicle.</li>
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/pickup" className="btn-primary">
            Start pickup
          </Link>
          <Link href="/attendant" className="btn-secondary">
            I&rsquo;m a lot attendant
          </Link>
        </div>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
          Demo records
        </h2>
        <p className="mt-2 text-sm text-valor-steel">
          Use any of these to try the flow end-to-end:
        </p>
        <ul className="mt-3 space-y-1 font-mono text-sm text-valor-navy">
          <li>Plate <b>7KLM342</b> &middot; Impound <b>IMP-24081</b> &middot; 2019 Honda Civic</li>
          <li>Plate <b>XTR-889</b> &middot; Impound <b>IMP-24082</b> &middot; 2021 Tesla Model 3</li>
          <li>Plate <b>GOVOL1</b> &middot; Impound <b>IMP-24083</b> &middot; 2017 Ford F-150</li>
        </ul>
      </section>
    </div>
  );
}
