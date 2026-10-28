import type { Metadata } from "next";
import Link from "next/link";

const CONTACT = (process.env.SUPPORT_EMAIL ?? "").trim() || "arvin.shakibi@hotmail.com";

export const metadata: Metadata = {
  title: "Integritet och radering av data – Whisper",
  description: "Vad Whisper sparar, varför, och hur du raderar ditt konto.",
  alternates: { canonical: "/integritet" },
};

const H2 = "mt-10 text-xl font-semibold";
const P = "mt-3 text-zinc-300";
const LI = "mt-1 text-zinc-300";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-safe pb-16 leading-relaxed">
      <p className="py-5">
        <Link href="/sv" className="text-xl font-semibold tracking-tight">
          whis<span className="text-violet-300">per</span>
        </Link>
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">Integritet</h1>
      <p className={P}>Senast uppdaterad 28 oktober 2026.</p>
      <p className={P}>
        Whisper drivs av TeknikFix (Axiom), CVR 46840992, Saltumvej 195, 9220 Aalborg Øst, Danmark. Frågor:{" "}
        <a className="text-violet-300 underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
        .
      </p>

      <h2 className={H2}>Det här sparar vi</h2>
      <ul className="mt-3 list-disc pl-5">
        <li className={LI}>Din e-postadress och ditt förnamn, för att du ska kunna logga in.</li>
        <li className={LI}>
          Ditt mobilnummer, som vi bekräftar med en SMS-kod. Det används bara för koder och för att samma person inte ska kunna skapa
          flera konton och få nya gratisminuter – aldrig för reklam.
        </li>
        <li className={LI}>När du godkände villkoren och vilken version, som bevis på avtalet.</li>
        <li className={LI}>
          Om du loggar in med Google, Apple, Facebook eller Microsoft: ett id från dem som visar att det är du. Vi får aldrig ditt
          lösenord där.
        </li>
        <li className={LI}>Ett krypterat lösenord. Vi kan aldrig se själva lösenordet.</li>
        <li className={LI}>Ditt saldo, dina påfyllningar och hur mycket du har använt.</li>
        <li className={LI}>
          Krypterade (hashade) spår av e-post, telefon och nätverk, så att samma person inte kan starta nya gratisperioder om och om
          igen.
        </li>
      </ul>

      <h2 className={H2}>Det här sparar vi inte</h2>
      <ul className="mt-3 list-disc pl-5">
        <li className={LI}>Ljudet från dina samtal sparas aldrig.</li>
        <li className={LI}>
          Texten från samtal, sammanfattningar och dina förberedelser (CV, dokument, länkar) sparas bara på din egen telefon, inte hos
          oss. De hör till ditt konto: lånar någon din telefon och loggar in med sitt eget konto ser de inte dina. Du raderar dem i
          appen.
        </li>
        <li className={LI}>
          Minnet (det Aivia har hört under dagen) ligger också bara på din telefon och raderas själv efter 1, 7, 14 eller 30 dagar,
          som du väljer. Du kan stänga av det, glömma en enskild stund eller radera allt under Inställningar.
        </li>
      </ul>

      <h2 className={H2}>Vilka vi delar med</h2>
      <ul className="mt-3 list-disc pl-5">
        <li className={LI}>
          AI-tjänster (till exempel Groq, OpenAI, Anthropic och Microsoft Azure) får ljud och text bara för att skriva ut vad som sägs
          och ta fram svar. Enligt deras API-villkor används det inte för att träna deras modeller.
        </li>
        <li className={LI}>Stripe hanterar betalningar. Vi ser aldrig ditt kortnummer.</li>
        <li className={LI}>Resend skickar e-post med inloggningskoder.</li>
        <li className={LI}>46elks (Sverige) skickar SMS med koder.</li>
      </ul>
      <p className={P}>
        Vi behandlar uppgifterna för att fullgöra avtalet med dig (konto, saldo, betalningar) och för vårt berättigade intresse av att
        stoppa fusk och missbruk (mobilnummer och de hashade spåren). Villkoren finns på{" "}
        <Link className="text-violet-300 underline" href="/villkor">
          sidan Villkor
        </Link>
        .
      </p>
      <p className={P}>Vi säljer aldrig dina uppgifter och visar ingen reklam.</p>

      <h2 className={H2} id="radera">
        Radera ditt konto och dina uppgifter
      </h2>
      <p className={P}>
        Skicka ett mejl till{" "}
        <a className="text-violet-300 underline" href={`mailto:${CONTACT}?subject=Radera%20mitt%20Whisper-konto`}>
          {CONTACT}
        </a>{" "}
        från adressen du loggar in med, med ämnet ”Radera mitt Whisper-konto”. Vi raderar kontot inom 30 dagar och bekräftar per mejl.
        Har du loggat in med Facebook kan du också ta bort Whisper under Facebook → Inställningar → Appar och webbplatser.
      </p>
      <p className={P}>
        Kvitton för betalningar sparas så länge bokföringslagen kräver. De hashade spåren mot upprepade gratisperioder raderas automatiskt:
        nätverk efter 7 dagar, e-post och telefon efter ett år.
      </p>

      <h2 className={H2}>Dina rättigheter</h2>
      <p className={P}>
        Enligt GDPR kan du be om en kopia av dina uppgifter, få dem rättade eller raderade. Du kan också klaga hos Datatilsynet i
        Danmark.
      </p>

      <hr className="my-12 border-white/10" />

      <section lang="en">
        <h2 className="text-2xl font-semibold">Privacy (English)</h2>
        <p className={P}>
          Whisper is run by TeknikFix (Axiom), CVR 46840992, Aalborg, Denmark. We store your email, first name, mobile number
          (confirmed by text, used only for codes and to stop repeated free trials, never for marketing), an encrypted password, the id
          from Google, Apple, Facebook or Microsoft if you sign in with them, when you accepted the terms, your balance and usage, and
          hashed marks that stop repeated free trials. Audio is never stored. Transcripts, summaries and prep documents are only saved on
          your phone, separately for each account signed in on it. Audio and text are sent to AI providers only to transcribe and answer. Stripe handles payments, Resend sends
          emails and 46elks sends text messages. We never sell your data. See also the{" "}
          <Link className="text-violet-300 underline" href="/villkor#en">
            terms
          </Link>
          .
        </p>
        <h3 className="mt-6 text-lg font-semibold" id="delete">
          Delete your data
        </h3>
        <p className={P}>
          Email{" "}
          <a className="text-violet-300 underline" href={`mailto:${CONTACT}?subject=Delete%20my%20Whisper%20account`}>
            {CONTACT}
          </a>{" "}
          from the address you sign in with, subject “Delete my Whisper account”. We delete the account within 30 days and confirm by
          email. Facebook users can also remove Whisper in Facebook → Settings → Apps and websites.
        </p>
      </section>
    </main>
  );
}
