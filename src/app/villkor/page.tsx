import type { Metadata } from "next";
import Link from "next/link";
import {
  ANSWER_ORE,
  CUSTOM_TOPUP_MAX,
  CUSTOM_TOPUP_MIN,
  DKK_PER_SEK,
  LISTEN_ORE_PER_MINUTE,
  TOPUPS,
  TRIAL_MAX_ANSWERS as TRIAL_ANSWERS,
  TRIAL_MINUTES,
} from "@/lib/shared/pricing";

const CONTACT = (process.env.SUPPORT_EMAIL ?? "").trim() || "arvin.shakibi@hotmail.com";
const COMPANY = "TeknikFix (Axiom), CVR 46840992, Saltumvej 195, 9220 Aalborg Øst, Danmark";
const SEK_TOPUPS = Object.values(TOPUPS).map((p) => p.sek).join(", ");
const DKK_TOPUPS = Object.values(TOPUPS).map((p) => p.dkk).join(", ");
const listenDkk = Math.round(LISTEN_ORE_PER_MINUTE * DKK_PER_SEK);
const answerDkk = Math.round(ANSWER_ORE * DKK_PER_SEK);

export const metadata: Metadata = {
  title: "Villkor – Whisper",
  description: "Villkoren för att använda Whisper: konto, gratisminuter, saldo, ångerrätt och ansvar.",
  alternates: { canonical: "/villkor" },
};

interface Section {
  h: string;
  p: string[];
}

interface Terms {
  id: string;
  lang: string;
  title: string;
  updated: string;
  sections: Section[];
}

const SV: Terms = {
  id: "sv",
  lang: "sv",
  title: "Villkor för Whisper",
  updated: "Gäller från 28 oktober 2026.",
  sections: [
    {
      h: "1. Vem du avtalar med",
      p: [
        `Whisper tillhandahålls av ${COMPANY} (”vi”). Villkoren gäller när du skapar ett konto eller använder Whisper. Frågor: ${CONTACT}.`,
      ],
    },
    {
      h: "2. Ditt konto",
      p: [
        "Du måste vara minst 18 år, eller ha godkännande från en vårdnadshavare, för att skapa ett konto och fylla på saldo.",
        "Uppgifterna du lämnar ska vara riktiga och dina egna. Varje person får ha ett konto, och varje konto kräver ett eget mobilnummer som bekräftas med en SMS-kod. Ett mobilnummer kan bara höra till ett konto.",
        "Du ansvarar för att hålla ditt lösenord hemligt och för det som görs med ditt konto.",
      ],
    },
    {
      h: "3. Gratisminuter",
      p: [
        `Ett nytt konto får ${TRIAL_MINUTES} gratisminuter tal, med upp till ${TRIAL_ANSWERS} svar, en gång per person. Gratisminuterna är till för att testa tjänsten och har inget penningvärde.`,
        "Det är inte tillåtet att skapa flera konton, använda någon annans eller tillfälliga mobilnummer eller e-postadresser, eller på annat sätt kringgå spärrarna för att få nya gratisminuter. Vi använder e-post, mobilnummer, enhet och nätverk för att upptäcka detta och kan neka eller dra in gratisminuter och stänga konton som bryter mot regeln.",
        "Gratisminuterna har ett gemensamt tak per dag och kan därför tillfälligt ta slut.",
      ],
    },
    {
      h: "4. Priser och saldo",
      p: [
        `Du betalar i förväg genom att fylla på saldo (${SEK_TOPUPS} kr i Sverige, ${DKK_TOPUPS} kr i Danmark, eller valfritt belopp från ${CUSTOM_TOPUP_MIN} till ${CUSTOM_TOPUP_MAX} kr). Lyssning kostar ${LISTEN_ORE_PER_MINUTE} öre per minut tal (${listenDkk} øre i DKK), och bara tid när någon pratar räknas. Varje svar du ber om kostar ${ANSWER_ORE} öre (${answerDkk} øre i DKK). Alla priser är inklusive moms.`,
        "Saldot går inte ut och inget dras automatiskt från ditt kort. Saldot kan inte överlåtas eller växlas till pengar, utom enligt punkt 5, 11 och 13 eller om vi lägger ner tjänsten – då betalar vi tillbaka det som inte har använts.",
        "Vi kan ändra priserna. Det meddelas i appen eller på hemsidan minst 30 dagar innan det gäller, och gäller bara användning efter ändringen. Godtar du inte en prishöjning kan du inom de 30 dagarna be om att få outnyttjat saldo tillbaka.",
        "Betalningar hanteras av Stripe. Vi ser aldrig ditt kortnummer.",
      ],
    },
    {
      h: "5. Ångerrätt",
      p: [
        "Du har 14 dagars ångerrätt från köpet av en påfyllning. När du fyller på ber du oss att tjänsten börjar direkt, så att du kan använda saldot med en gång.",
        `Ångrar du dig inom 14 dagar får du tillbaka den del av påfyllningen som inte har använts. Det du redan har använt betalar du för. Skriv till ${CONTACT} med din e-postadress och vilken påfyllning det gäller. Vi betalar tillbaka inom 14 dagar till samma betalningssätt.`,
      ],
    },
    {
      h: "6. Hur du får använda Whisper",
      p: [
        "Du får bara använda Whisper på lagliga sätt. Du ansvarar för att du har rätt att lyssna på och skriva ut de samtal du använder Whisper i, och för att berätta det för de andra när lagen eller situationen kräver det.",
        "Du ansvarar för att följa reglerna där du använder Whisper, till exempel regler om hjälpmedel vid prov, tentor och tester, och arbetsgivares eller myndigheters regler om sekretess.",
        "Det är inte tillåtet att försöka komma åt andras konton, kringgå betalningen, använda robotar eller automatiska verktyg mot tjänsten, belasta den onormalt, kopiera eller sälja vidare tjänsten, eller försöka ta fram källkoden.",
      ],
    },
    {
      h: "7. AI-svar",
      p: [
        "Svar, sammanfattningar och utskrifter tas fram automatiskt av AI och kan vara felaktiga, ofullständiga eller inaktuella. De är inte medicinska, juridiska, ekonomiska eller andra professionella råd.",
        "Du bestämmer själv vad du säger och gör. Kontrollera viktiga uppgifter innan du förlitar dig på dem.",
      ],
    },
    {
      h: "8. Ditt innehåll",
      p: [
        "Det du laddar upp eller säger (till exempel CV, dokument, länkar och samtal) är ditt. Du ger oss rätt att behandla det bara för att leverera tjänsten till dig. Vi använder det inte för att träna AI-modeller, och våra AI-leverantörer gör det inte heller enligt sina villkor.",
        "Du ansvarar för att du har rätt att ladda upp det du laddar upp.",
      ],
    },
    {
      h: "9. Tillgänglighet och ändringar i tjänsten",
      p: [
        "Vi gör vårt bästa för att Whisper ska fungera, men kan inte lova att tjänsten alltid är tillgänglig eller fri från fel. Vi kan ändra, lägga till eller ta bort funktioner. Tar vi bort något väsentligt som du har betalat för kan du få outnyttjat saldo tillbaka.",
      ],
    },
    {
      h: "10. Ansvar",
      p: [
        "Så långt lagen tillåter ansvarar vi inte för indirekta förluster, till exempel utebliven inkomst, en missad anställning eller förlorad data, och vårt sammanlagda ansvar är begränsat till det du har betalat oss de senaste 12 månaderna.",
        "Begränsningen gäller inte om vi har orsakat skadan med avsikt eller grov vårdslöshet, och den inskränker inte de rättigheter du har som konsument enligt tvingande lag.",
      ],
    },
    {
      h: "11. Avsluta och stänga konton",
      p: [
        `Du kan när som helst radera ditt konto genom att skriva till ${CONTACT}. Begär du det samtidigt får du tillbaka outnyttjat saldo från påfyllningar gjorda de senaste 14 dagarna enligt punkt 5.`,
        "Vi kan stänga av eller stänga ett konto som bryter mot villkoren, särskilt vid fusk med gratisminuter, missbruk av betalningar eller olaglig användning. Stänger vi ett konto utan att du har brutit mot villkoren får du tillbaka outnyttjat saldo. Stänger vi det på grund av ett brott mot villkoren betalar vi tillbaka outnyttjat saldo med avdrag för de kostnader brottet har orsakat oss.",
      ],
    },
    {
      h: "12. Personuppgifter",
      p: [
        "Vi sparar ditt namn, din e-postadress, ditt mobilnummer, ett krypterat lösenord, ditt saldo och din användning, när du godkände villkoren, och krypterade spår som stoppar upprepade gratisperioder. Mobilnumret används bara för koder och för att stoppa fusk – aldrig för reklam – och vi säljer aldrig dina uppgifter. Ljudet från dina samtal sparas aldrig. Läs mer på sidan Integritet.",
      ],
    },
    {
      h: "13. Ändringar av villkoren",
      p: [
        "Vi kan ändra villkoren. Väsentliga ändringar meddelas i appen, och du behöver godkänna de nya villkoren för att fortsätta använda Whisper. Godtar du dem inte kan du sluta använda tjänsten och få outnyttjat saldo tillbaka.",
      ],
    },
    {
      h: "14. Lag och tvister",
      p: [
        "Dansk lag gäller. Bor du i ett annat EU-land behåller du det skydd som tvingande konsumentregler i ditt land ger dig.",
        `Kontakta oss först på ${CONTACT} så försöker vi lösa det. Du kan också klaga till Nævnenes Hus i Danmark (naevneneshus.dk) eller, om du bor i Sverige, till Allmänna reklamationsnämnden (arn.se).`,
      ],
    },
  ],
};

const DA: Terms = {
  id: "da",
  lang: "da",
  title: "Vilkår for Whisper",
  updated: "Gælder fra 28. oktober 2026.",
  sections: [
    {
      h: "1. Hvem du indgår aftale med",
      p: [
        `Whisper leveres af ${COMPANY} (”vi”). Vilkårene gælder, når du opretter en konto eller bruger Whisper. Spørgsmål: ${CONTACT}.`,
      ],
    },
    {
      h: "2. Din konto",
      p: [
        "Du skal være mindst 18 år eller have samtykke fra en forælder eller værge for at oprette en konto og fylde saldo på.",
        "Oplysningerne, du giver, skal være rigtige og dine egne. Hver person må have én konto, og hver konto kræver sit eget mobilnummer, som bekræftes med en sms-kode. Et mobilnummer kan kun høre til én konto.",
        "Du er ansvarlig for at holde din adgangskode hemmelig og for det, der sker med din konto.",
      ],
    },
    {
      h: "3. Gratisminutter",
      p: [
        `En ny konto får ${TRIAL_MINUTES} gratisminutters tale med op til ${TRIAL_ANSWERS} svar, én gang pr. person. Gratisminutterne er til at prøve tjenesten og har ingen pengeværdi.`,
        "Det er ikke tilladt at oprette flere konti, bruge andres eller midlertidige mobilnumre eller e-mailadresser eller på anden måde omgå spærringerne for at få nye gratisminutter. Vi bruger e-mail, mobilnummer, enhed og netværk til at opdage det og kan afvise eller fratage gratisminutter og lukke konti, der bryder reglen.",
        "Gratisminutterne har et fælles loft pr. dag og kan derfor midlertidigt være opbrugt.",
      ],
    },
    {
      h: "4. Priser og saldo",
      p: [
        `Du betaler forud ved at fylde saldo på (${DKK_TOPUPS} kr. i Danmark, ${SEK_TOPUPS} kr. i Sverige, eller et valgfrit beløb fra ${CUSTOM_TOPUP_MIN} til ${CUSTOM_TOPUP_MAX} kr.). Lytning koster ${listenDkk} øre pr. minuts tale (${LISTEN_ORE_PER_MINUTE} öre i SEK), og kun tid, hvor nogen taler, tæller. Hvert svar, du beder om, koster ${answerDkk} øre (${ANSWER_ORE} öre i SEK). Alle priser er inkl. moms.`,
        "Saldoen udløber ikke, og der trækkes aldrig automatisk fra dit kort. Saldoen kan ikke overdrages eller veksles til penge, undtagen efter punkt 5, 11 og 13, eller hvis vi lukker tjenesten – så betaler vi det ubrugte tilbage.",
        "Vi kan ændre priserne. Det meddeles i appen eller på hjemmesiden mindst 30 dage før, og det gælder kun brug efter ændringen. Accepterer du ikke en prisstigning, kan du inden for de 30 dage bede om at få den ubrugte saldo tilbage.",
        "Betalinger håndteres af Stripe. Vi ser aldrig dit kortnummer.",
      ],
    },
    {
      h: "5. Fortrydelsesret",
      p: [
        "Du har 14 dages fortrydelsesret fra købet af en optankning. Når du fylder på, beder du os om at starte tjenesten med det samme, så du kan bruge saldoen med det samme.",
        `Fortryder du inden for 14 dage, får du den del af optankningen tilbage, som ikke er brugt. Det, du allerede har brugt, betaler du for. Skriv til ${CONTACT} med din e-mailadresse og hvilken optankning, det gælder. Vi betaler tilbage inden for 14 dage til samme betalingsmiddel.`,
      ],
    },
    {
      h: "6. Sådan må du bruge Whisper",
      p: [
        "Du må kun bruge Whisper lovligt. Du er ansvarlig for, at du har ret til at lytte til og skrive de samtaler ud, du bruger Whisper i, og for at fortælle det til de andre, når loven eller situationen kræver det.",
        "Du er ansvarlig for at følge reglerne der, hvor du bruger Whisper, for eksempel regler om hjælpemidler ved prøver, eksamener og test og arbejdsgiveres eller myndigheders regler om tavshedspligt.",
        "Det er ikke tilladt at forsøge at få adgang til andres konti, omgå betalingen, bruge robotter eller automatiske værktøjer mod tjenesten, belaste den unormalt, kopiere eller videresælge tjenesten eller forsøge at udlede kildekoden.",
      ],
    },
    {
      h: "7. AI-svar",
      p: [
        "Svar, resuméer og udskrifter laves automatisk af AI og kan være forkerte, ufuldstændige eller forældede. De er ikke lægelig, juridisk, økonomisk eller anden professionel rådgivning.",
        "Du bestemmer selv, hvad du siger og gør. Kontrollér vigtige oplysninger, før du stoler på dem.",
      ],
    },
    {
      h: "8. Dit indhold",
      p: [
        "Det, du uploader eller siger (for eksempel CV, dokumenter, links og samtaler), er dit. Du giver os ret til at behandle det udelukkende for at levere tjenesten til dig. Vi bruger det ikke til at træne AI-modeller, og det gør vores AI-leverandører heller ikke efter deres vilkår.",
        "Du er ansvarlig for, at du har ret til at uploade det, du uploader.",
      ],
    },
    {
      h: "9. Tilgængelighed og ændringer i tjenesten",
      p: [
        "Vi gør vores bedste for, at Whisper virker, men kan ikke love, at tjenesten altid er tilgængelig eller fejlfri. Vi kan ændre, tilføje eller fjerne funktioner. Fjerner vi noget væsentligt, du har betalt for, kan du få den ubrugte saldo tilbage.",
      ],
    },
    {
      h: "10. Ansvar",
      p: [
        "I det omfang loven tillader det, er vi ikke ansvarlige for indirekte tab, for eksempel tabt indtjening, et mistet job eller tabte data, og vores samlede ansvar er begrænset til det, du har betalt os de seneste 12 måneder.",
        "Begrænsningen gælder ikke, hvis vi har forvoldt skaden forsætligt eller groft uagtsomt, og den indskrænker ikke dine rettigheder som forbruger efter ufravigelige regler.",
      ],
    },
    {
      h: "11. Opsigelse og lukning af konti",
      p: [
        `Du kan til enhver tid slette din konto ved at skrive til ${CONTACT}. Beder du om det samtidig, får du den ubrugte saldo fra optankninger de seneste 14 dage tilbage efter punkt 5.`,
        "Vi kan spærre eller lukke en konto, der bryder vilkårene, særligt ved snyd med gratisminutter, misbrug af betalinger eller ulovlig brug. Lukker vi en konto, uden at du har brudt vilkårene, får du den ubrugte saldo tilbage. Lukker vi den på grund af brud på vilkårene, betaler vi den ubrugte saldo tilbage med fradrag af de omkostninger, bruddet har påført os.",
      ],
    },
    {
      h: "12. Personoplysninger",
      p: [
        "Vi gemmer dit navn, din e-mailadresse, dit mobilnummer, en krypteret adgangskode, din saldo og dit forbrug, hvornår du accepterede vilkårene, og krypterede spor, der stopper gentagne gratisperioder. Mobilnummeret bruges kun til koder og til at stoppe snyd – aldrig til reklame – og vi sælger aldrig dine oplysninger. Lyden fra dine samtaler gemmes aldrig. Læs mere på siden Integritet.",
      ],
    },
    {
      h: "13. Ændringer af vilkårene",
      p: [
        "Vi kan ændre vilkårene. Væsentlige ændringer meddeles i appen, og du skal acceptere de nye vilkår for at fortsætte med at bruge Whisper. Accepterer du dem ikke, kan du stoppe med at bruge tjenesten og få den ubrugte saldo tilbage.",
      ],
    },
    {
      h: "14. Lovvalg og tvister",
      p: [
        "Dansk ret gælder. Bor du i et andet EU-land, beholder du den beskyttelse, som ufravigelige forbrugerregler i dit land giver dig.",
        `Kontakt os først på ${CONTACT}, så forsøger vi at løse det. Du kan også klage til Nævnenes Hus (naevneneshus.dk) eller, hvis du bor i Sverige, til Allmänna reklamationsnämnden (arn.se).`,
      ],
    },
  ],
};

const EN: Terms = {
  id: "en",
  lang: "en",
  title: "Whisper terms",
  updated: "In force from 28 October 2026.",
  sections: [
    {
      h: "1. Who you contract with",
      p: [
        `Whisper is provided by ${COMPANY} (“we”). These terms apply when you create an account or use Whisper. Questions: ${CONTACT}.`,
      ],
    },
    {
      h: "2. Your account",
      p: [
        "You must be at least 18, or have a parent's or guardian's consent, to create an account and top up.",
        "The details you give must be true and your own. Each person may have one account, and each account needs its own mobile number, confirmed with a text code. A mobile number can only belong to one account.",
        "You are responsible for keeping your password secret and for what is done with your account.",
      ],
    },
    {
      h: "3. Free minutes",
      p: [
        `A new account gets ${TRIAL_MINUTES} free minutes of speech, with up to ${TRIAL_ANSWERS} answers, once per person. The free minutes are for trying the service and have no cash value.`,
        "You may not create several accounts, use someone else's or temporary phone numbers or email addresses, or otherwise get around the limits to get new free minutes. We use email, phone number, device and network to detect this and may refuse or withdraw free minutes and close accounts that break this rule.",
        "Free minutes share a daily cap and may therefore run out for the day.",
      ],
    },
    {
      h: "4. Prices and balance",
      p: [
        `You pay in advance by topping up (SEK ${SEK_TOPUPS} or DKK ${DKK_TOPUPS}, or any amount from ${CUSTOM_TOPUP_MIN} to ${CUSTOM_TOPUP_MAX} kr). Listening costs ${LISTEN_ORE_PER_MINUTE} öre per minute of speech (${listenDkk} øre in DKK), and only time when someone speaks counts. Each answer you ask for costs ${ANSWER_ORE} öre (${answerDkk} øre in DKK). All prices include VAT.`,
        "The balance does not expire and nothing is ever charged to your card automatically. It cannot be transferred or exchanged for money, except under sections 5, 11 and 13, or if we shut the service down – then we refund what is unused.",
        "We may change prices. We announce it in the app or on the website at least 30 days before, and it only applies to use after the change. If you do not accept a price increase, you may ask for your unused balance back within those 30 days.",
        "Payments are handled by Stripe. We never see your card number.",
      ],
    },
    {
      h: "5. Right of withdrawal",
      p: [
        "You have 14 days to withdraw from the purchase of a top-up. When you top up, you ask us to start the service right away, so you can use the balance at once.",
        `If you withdraw within 14 days, you get back the part of the top-up that has not been used. You pay for what you have already used. Write to ${CONTACT} with your email address and which top-up it concerns. We refund within 14 days to the same payment method.`,
      ],
    },
    {
      h: "6. How you may use Whisper",
      p: [
        "You may only use Whisper lawfully. You are responsible for having the right to listen to and transcribe the conversations you use Whisper in, and for telling the others when the law or the situation requires it.",
        "You are responsible for following the rules where you use Whisper, for example rules on aids in exams and tests, and employers' or authorities' confidentiality rules.",
        "You may not try to access other people's accounts, get around payment, use bots or automated tools against the service, overload it, copy or resell the service, or try to derive its source code.",
      ],
    },
    {
      h: "7. AI answers",
      p: [
        "Answers, summaries and transcripts are produced automatically by AI and may be wrong, incomplete or out of date. They are not medical, legal, financial or other professional advice.",
        "You decide what you say and do. Check important information before relying on it.",
      ],
    },
    {
      h: "8. Your content",
      p: [
        "What you upload or say (for example CVs, documents, links and conversations) is yours. You allow us to process it only to provide the service to you. We do not use it to train AI models, and under their terms our AI providers do not either.",
        "You are responsible for having the right to upload what you upload.",
      ],
    },
    {
      h: "9. Availability and changes to the service",
      p: [
        "We do our best to keep Whisper working, but cannot promise it is always available or free of errors. We may change, add or remove features. If we remove something essential that you have paid for, you can get your unused balance back.",
      ],
    },
    {
      h: "10. Liability",
      p: [
        "As far as the law allows, we are not liable for indirect losses, such as lost income, a missed job or lost data, and our total liability is limited to what you paid us in the last 12 months.",
        "This limit does not apply to damage we cause intentionally or through gross negligence, and it does not reduce your rights as a consumer under mandatory law.",
      ],
    },
    {
      h: "11. Ending and closing accounts",
      p: [
        `You can delete your account at any time by writing to ${CONTACT}. If you ask at the same time, you get back the unused balance from top-ups made in the last 14 days under section 5.`,
        "We may suspend or close an account that breaks these terms, especially for abuse of free minutes, payment abuse or unlawful use. If we close an account without a breach on your part, you get your unused balance back. If we close it because of a breach, we refund the unused balance minus the costs the breach caused us.",
      ],
    },
    {
      h: "12. Personal data",
      p: [
        "We store your name, email address, mobile number, an encrypted password, your balance and usage, when you accepted the terms, and hashed marks that stop repeated free trials. The mobile number is only used for codes and to stop abuse – never for marketing – and we never sell your data. Audio from your conversations is never stored. See the Privacy page.",
      ],
    },
    {
      h: "13. Changes to these terms",
      p: [
        "We may change these terms. Material changes are announced in the app, and you need to accept the new terms to keep using Whisper. If you do not accept them, you can stop using the service and get your unused balance back.",
      ],
    },
    {
      h: "14. Law and disputes",
      p: [
        "Danish law applies. If you live in another EU country, you keep the protection that mandatory consumer rules in your country give you.",
        `Contact us first at ${CONTACT} and we will try to solve it. You can also complain to Nævnenes Hus in Denmark (naevneneshus.dk) or, if you live in Sweden, to Allmänna reklamationsnämnden (arn.se).`,
      ],
    },
  ],
};

function TermsSection({ terms }: { terms: Terms }) {
  return (
    <section id={terms.id} lang={terms.lang} className="scroll-mt-6">
      <h1 className="text-3xl font-semibold tracking-tight">{terms.title}</h1>
      <p className="mt-3 text-zinc-400">{terms.updated}</p>
      {terms.sections.map((s) => (
        <div key={s.h}>
          <h2 className="mt-10 text-xl font-semibold">{s.h}</h2>
          {s.p.map((text) => (
            <p key={text.slice(0, 40)} className="mt-3 text-zinc-300">
              {text}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-safe pb-16 leading-relaxed">
      <div className="flex items-center justify-between py-5">
        <Link href="/sv" className="text-xl font-semibold tracking-tight">
          whis<span className="text-violet-300">per</span>
        </Link>
        <nav className="flex gap-4 text-sm text-violet-300">
          <a href="#sv">Svenska</a>
          <a href="#da">Dansk</a>
          <a href="#en">English</a>
        </nav>
      </div>
      <TermsSection terms={SV} />
      <hr className="my-12 border-white/10" />
      <TermsSection terms={DA} />
      <hr className="my-12 border-white/10" />
      <TermsSection terms={EN} />
    </main>
  );
}
