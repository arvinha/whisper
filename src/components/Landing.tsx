import type { Metadata } from "next";
import Link from "next/link";
import type { UiLang } from "@/lib/i18n";
import { UI_LANG_NAMES } from "@/lib/i18n";
import { LANDING, shownPoints } from "@/lib/landing";
import { LANDING_LANGS, LANDING_PATHS, SITE_URL } from "@/lib/site";

const LOCALES: Record<UiLang, string> = { sv: "sv_SE", da: "da_DK", en: "en_US" };

export function landingMetadata(lang: UiLang): Metadata {
  const copy = LANDING[lang];
  // A page-level openGraph object replaces the inherited one, so the image must be named here.
  const image = { url: `${LANDING_PATHS[lang]}/opengraph-image`, width: 1200, height: 630, alt: "Whisper" };
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical: LANDING_PATHS[lang], languages: LANDING_LANGS },
    openGraph: {
      type: "website",
      locale: LOCALES[lang],
      siteName: "Whisper",
      title: copy.title,
      description: copy.description,
      url: LANDING_PATHS[lang],
      images: [image],
    },
    twitter: { card: "summary_large_image", title: copy.title, description: copy.description, images: [image] },
  };
}

function jsonLd(lang: UiLang): string {
  const copy = LANDING[lang];
  const url = `${SITE_URL}${LANDING_PATHS[lang]}`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Whisper",
        alternateName: "Whisper med Aivia",
        applicationCategory: "ProductivityApplication",
        operatingSystem: "iOS, Android, Web",
        url,
        inLanguage: lang,
        description: copy.description,
        offers: [
          { "@type": "Offer", name: "5 h", price: lang === "da" ? 35 : 49, priceCurrency: lang === "da" ? "DKK" : "SEK" },
          { "@type": "Offer", name: "15 h", price: lang === "da" ? 85 : 119, priceCurrency: lang === "da" ? "DKK" : "SEK" },
          { "@type": "Offer", name: "40 h", price: lang === "da" ? 179 : 249, priceCurrency: lang === "da" ? "DKK" : "SEK" },
        ],
        publisher: { "@type": "Organization", name: "TeknikFix", url: "https://teknikfix.dk" },
      },
      {
        "@type": "FAQPage",
        inLanguage: lang,
        mainEntity: copy.faq.map(([q, a]) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const CARD = "rounded-2xl border border-white/10 bg-white/[0.03] p-5";

export function Landing({ lang }: { lang: UiLang }) {
  const copy = LANDING[lang];
  const why = shownPoints(copy.why);
  return (
    <div lang={lang} className="min-h-dvh overflow-y-auto">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(lang) }} />
      <main className="mx-auto w-full max-w-5xl px-6 pt-safe pb-16">
        <header className="flex items-center justify-between py-5">
          <Link href="/" className="text-xl font-semibold tracking-tight">
            whis<span className="text-violet-300">per</span>
          </Link>
          <Link href="/" className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400">
            {copy.cta}
          </Link>
        </header>

        <section className="py-14 text-center sm:py-20">
          <p className="text-sm font-semibold tracking-wide text-violet-300 uppercase">{copy.kicker}</p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">{copy.h1}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-balance text-zinc-400">{copy.lead}</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href="/"
              className="rounded-full bg-violet-500 px-8 py-4 text-lg font-semibold text-white shadow-[0_0_60px_-10px_rgba(167,139,250,0.8)] hover:bg-violet-400"
            >
              {copy.cta}
            </Link>
            <p className="text-sm font-medium text-emerald-300">{copy.ctaNote}</p>
          </div>
        </section>

        <section className="py-10" id="varfor">
          <div className="rounded-3xl border border-violet-400/25 bg-gradient-to-b from-violet-500/[0.12] to-transparent px-6 py-10 text-center sm:px-12">
            <p className="text-sm font-semibold tracking-wide text-violet-300 uppercase">{copy.whyKicker}</p>
            <h2 className="mx-auto mt-4 max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
              {copy.whyQuote}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-balance text-zinc-300">{copy.whyLead}</p>
            <div className={`mt-10 grid gap-4 text-left ${why.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
              {why.map(([title, text]) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-black/30 p-5">
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-zinc-400">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-10">
          <h2 className="text-center text-3xl font-semibold tracking-tight">{copy.stepsTitle}</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {copy.steps.map(([title, text], i) => (
              <li key={title} className={CARD}>
                <span className="grid size-9 place-items-center rounded-full bg-violet-500/20 font-semibold text-violet-200">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-zinc-400">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="py-10">
          <h2 className="text-center text-3xl font-semibold tracking-tight">{copy.usesTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {copy.uses.map(([title, text]) => (
              <div key={title} className={CARD}>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-zinc-400">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-10">
          <h2 className="text-center text-3xl font-semibold tracking-tight">{copy.featuresTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shownPoints(copy.features).map(([title, text]) => (
              <div key={title} className={CARD}>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-zinc-400">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-10" id="priser">
          <h2 className="text-center text-3xl font-semibold tracking-tight">{copy.pricesTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {copy.prices.map((plan, i) => (
              <div
                key={plan.name}
                className={`rounded-2xl border p-5 ${
                  i === 0
                    ? "border-emerald-400/40 bg-emerald-500/[0.06]"
                    : i === 2
                      ? "border-violet-400/50 bg-violet-500/10"
                      : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <h3 className="font-semibold text-zinc-300">{plan.name}</h3>
                <p className="mt-2 text-2xl font-semibold">{plan.price}</p>
                <p className="mt-2 text-sm text-zinc-400">{plan.note}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-zinc-500">{copy.pricesNote}</p>
        </section>

        <section className="mx-auto max-w-3xl py-10">
          <h2 className="text-center text-3xl font-semibold tracking-tight">{copy.faqTitle}</h2>
          <div className="mt-8 space-y-3">
            {copy.faq.map(([q, a]) => (
              <details key={q} className={CARD}>
                <summary className="cursor-pointer font-semibold">{q}</summary>
                <p className="mt-2 text-zinc-400">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="py-14 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance">{copy.closing}</h2>
          <Link href="/" className="mt-6 inline-block rounded-full bg-violet-500 px-8 py-4 text-lg font-semibold text-white hover:bg-violet-400">
            {copy.cta}
          </Link>
          <p className="mt-3 text-sm font-medium text-emerald-300">{copy.ctaNote}</p>
        </section>

        <footer className="border-t border-white/10 pt-6 text-sm text-zinc-500">
          <p>
            {copy.otherLangs}:{" "}
            {(Object.keys(LANDING_PATHS) as UiLang[])
              .filter((other) => other !== lang)
              .map((other, i) => (
                <span key={other}>
                  {i > 0 && " · "}
                  <Link href={LANDING_PATHS[other]} hrefLang={other} className="underline hover:text-zinc-300">
                    {UI_LANG_NAMES[other]}
                  </Link>
                </span>
              ))}
          </p>
          <p className="mt-2">
            <Link href="/integritet" className="underline hover:text-zinc-300">
              {copy.privacy}
            </Link>
          </p>
          <p className="mt-2">
            {copy.madeBy}{" "}
            <a href="https://teknikfix.dk" className="underline hover:text-zinc-300">
              teknikfix.dk
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
