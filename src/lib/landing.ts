import type { UiLang } from "@/lib/i18n";
import { FEATURES } from "@/lib/shared/features";

/** A point about a feature that can be switched off; it is only shown while the feature is on. */
type Point = [title: string, text: string, feature?: keyof typeof FEATURES];

export function shownPoints(points: Point[]): Point[] {
  return points.filter(([, , feature]) => !feature || FEATURES[feature]);
}

export interface LandingCopy {
  title: string;
  description: string;
  kicker: string;
  h1: string;
  lead: string;
  cta: string;
  ctaNote: string;
  whyKicker: string;
  whyQuote: string;
  whyLead: string;
  why: Point[];
  stepsTitle: string;
  steps: Array<[string, string]>;
  usesTitle: string;
  uses: Array<[string, string]>;
  featuresTitle: string;
  features: Point[];
  pricesTitle: string;
  prices: Array<{ name: string; price: string; note: string }>;
  pricesNote: string;
  faqTitle: string;
  faq: Array<[string, string]>;
  closing: string;
  otherLangs: string;
  privacy: string;
  madeBy: string;
}

export const LANDING: Record<UiLang, LandingCopy> = {
  sv: {
    title: "Whisper – AI-assistent för möten, redovisningar och anteckningar",
    description:
      "Whisper följer dina samtal, antecknar live och har ditt eget underlag redo. Ett tryck ger dig en kort ledtråd utifrån samtalet och dina dokument. Få sammanfattning och påminnelser efteråt. Testa gratis i 2 dagar.",
    kicker: "AI-assistent för samtal",
    h1: "Din AI-assistent i varje samtal",
    lead: "Whisper följer samtalet med dig. Den antecknar live, har dina egna dokument, länkar och din kod redo, och med ett tryck får du en kort ledtråd om det som är viktigt just nu. Efteråt får du en sammanfattning med påminnelser.",
    cta: "Testa gratis",
    ctaNote: "2 dagar gratis · inget kort behövs",
    whyKicker: "Varför Aivia?",
    whyQuote: "ChatGPT är en hjärna du måste gå till. Aivia är öronen som redan är på plats.",
    whyLead:
      "Dagens AI är smart men blind: den vet bara det du skriver in. Aivia vet redan vad som just sades, så hon kan hjälpa dig utan att du behöver stanna upp och förklara.",
    why: [
      ["Hon var där", "ChatGPT måste få allt förklarat för sig. Aivia har redan hört samtalet, så hon kan svara på ”vad sa läkaren?”."],
      ["Inget skrivande, inget förklarande", "Du behöver inte stanna upp och skriva en fråga. Tryck en gång på skärmen eller hörlurarna så ger Aivia dig en kort ledtråd utifrån det som just sades och ditt eget underlag."],
      ["Hon märker det själv", "Säger någon ”din tid är torsdag kl 9” föreslår Aivia att lägga in den. Du behöver inte ens komma ihåg att fråga.", "calendar"],
    ],
    stepsTitle: "Så funkar det",
    steps: [
      ["Förbered", "Ladda upp anteckningar, presentation eller dokument. Klistra in länkar till hemsidor, artiklar eller ditt GitHub."],
      ["Starta", "Starta Whisper när samtalet börjar. Aivia antecknar live medan du fokuserar på människorna framför dig."],
      ["Tryck", "Behöver du en detalj eller en siffra ur ditt underlag? Tryck, så ger Aivia dig en kort ledtråd på några sekunder."],
    ],
    usesTitle: "Gjort för samtal som betyder något",
    uses: [
      ["Möten", "Missa aldrig vad som sades. Få sammanfattning, beslut och att göra."],
      ["Redovisning", "Ha dina egna fakta och siffror nära till hands när publiken ställer följdfrågor."],
      ["Inför intervjun", "Öva med ditt CV och jobbannonsen och få frågor du sannolikt kommer att få."],
      ["Din egen kod", "Aivia läser dina repon och hjälper dig förklara vad du byggt, med dina egna ord."],
      ["Föreläsningar och plugg", "Ladda upp anteckningar och låt Aivia förhöra dig. Fråga efteråt vad läraren sa."],
      ["Kundmöten", "Produktfakta och priser från dina egna dokument, redo när du behöver dem."],
    ],
    featuresTitle: "Allt i en app",
    features: [
      ["Läser länkar åt dig", "Hemsidor, artiklar, produktsidor och jobbannonser hämtas automatiskt."],
      ["Förstår din kod", "Lägg till GitHub eller ladda upp en zip. Aivia hittar rätt fil när frågan kommer."],
      ["Transkribering i realtid", "Se vad som sägs medan det sägs, på svenska, danska och engelska."],
      ["Minns din dag", "Fråga i efterhand, t.ex. ”vad sa läraren om tentan?”. Tider och påminnelser föreslås av sig själva.", "notes"],
      ["Ljudet sparas aldrig", "Bara texten du själv väljer att spara finns kvar."],
      ["Funkar i mobilen", "Lägg Whisper på hemskärmen i iPhone eller Android – ingen nedladdning."],
    ],
    pricesTitle: "Priser",
    prices: [
      { name: "Provperiod", price: "0 kr", note: "2 dagar eller 3 timmar. Inget kort." },
      { name: "5 timmar", price: "49 kr", note: "Räcker till några möten eller redovisningar." },
      { name: "15 timmar", price: "119 kr", note: "Populärast. Räcker långt för jobb, möten och plugg." },
      { name: "40 timmar", price: "249 kr", note: "Bäst pris per timme." },
    ],
    pricesNote:
      "Som ett kontantkort: timmarna räknas bara ner när Aivia lyssnar och går aldrig ut. Inget abonnemang. Priser inkl. moms.",
    faqTitle: "Vanliga frågor",
    faq: [
      ["Behöver jag ladda ner något?", "Nej. Whisper körs i webbläsaren. På iPhone trycker du Dela → Lägg till på hemskärmen, så fungerar den som en app."],
      ["Vilka språk förstår Whisper?", "Svenska, danska och engelska – och svaren kommer på samma språk som samtalet."],
      ["Sparas det som sägs?", "Ljudet sparas aldrig. Texten sparas bara på din telefon – inte hos oss – tills du raderar den."],
      ["Kan Aivia läsa mitt GitHub?", "Ja. Skriv ditt användarnamn eller klistra in en länk till ett repo, så väljer du vilka projekt Aivia ska läsa."],
      [
        "Varför inte bara använda ChatGPT eller Gemini?",
        "De är bra hjärnor, men de vet bara det du skriver in, och du måste stanna upp och fråga. Aivia har redan hört samtalet, ger dig en kort ledtråd när du trycker, och föreslår själv tider och påminnelser från det hon hört. Använd gärna båda.",
      ],
      ["Vad händer efter provperioden?", "Ingenting dras automatiskt. Vill du fortsätta köper du timmar, som ett kontantkort. De går aldrig ut."],
    ],
    closing: "Nästa viktiga samtal kan bli ditt bästa.",
    otherLangs: "Andra språk",
    privacy: "Integritet och radering av data",
    madeBy: "Whisper är gjort av Axiom i Aalborg.",
  },
  da: {
    title: "Whisper – AI-assistent til møder, fremlæggelser og noter",
    description:
      "Whisper følger dine samtaler, tager noter live og har dit eget materiale klar. Ét tryk giver dig et kort stikord ud fra samtalen og dine dokumenter. Få referat og påmindelser bagefter. Prøv gratis i 2 dage.",
    kicker: "AI-assistent til samtaler",
    h1: "Din AI-assistent i hver samtale",
    lead: "Whisper følger samtalen sammen med dig. Den tager noter live, har dine egne dokumenter, links og din kode klar, og med ét tryk får du et kort stikord om det, der er vigtigt lige nu. Bagefter får du et referat med påmindelser.",
    cta: "Prøv gratis",
    ctaNote: "2 dage gratis · intet kort nødvendigt",
    whyKicker: "Hvorfor Aivia?",
    whyQuote: "ChatGPT er en hjerne, du skal gå hen til. Aivia er ørerne, der allerede er på plads.",
    whyLead:
      "Nutidens AI er klog, men blind: den ved kun det, du skriver ind. Aivia ved allerede, hvad der lige blev sagt, så hun kan hjælpe dig uden at du skal stoppe op og forklare.",
    why: [
      ["Hun var der", "ChatGPT skal have alt forklaret. Aivia har allerede hørt samtalen, så hun kan svare på ”hvad sagde lægen?”."],
      ["Ingen skrivning, ingen forklaring", "Du behøver ikke stoppe op og skrive et spørgsmål. Tryk én gang på skærmen eller høretelefonerne, så giver Aivia dig et kort stikord ud fra det, der lige blev sagt, og dit eget materiale."],
      ["Hun opdager det selv", "Siger nogen ”din tid er torsdag kl. 9”, foreslår Aivia at lægge den ind. Du behøver ikke engang huske at spørge.", "calendar"],
    ],
    stepsTitle: "Sådan virker det",
    steps: [
      ["Forbered", "Upload noter, præsentation eller dokumenter. Indsæt links til hjemmesider, artikler eller dit GitHub."],
      ["Start", "Start Whisper, når samtalen begynder. Aivia tager noter live, mens du fokuserer på menneskene foran dig."],
      ["Tryk", "Mangler du en detalje eller et tal fra dit materiale? Tryk, så giver Aivia dig et kort stikord på få sekunder."],
    ],
    usesTitle: "Lavet til samtaler, der betyder noget",
    uses: [
      ["Møder", "Gå aldrig glip af noget. Få referat, beslutninger og to-dos."],
      ["Fremlæggelse", "Hav dine egne fakta og tal ved hånden, når publikum stiller opfølgende spørgsmål."],
      ["Før jobsamtalen", "Øv dig med dit CV og jobopslaget, og få de spørgsmål, du sandsynligvis bliver stillet."],
      ["Din egen kode", "Aivia læser dine repos og hjælper dig med at forklare, hvad du har bygget, med dine egne ord."],
      ["Forelæsninger og læsning", "Upload noter, og lad Aivia høre dig. Spørg bagefter, hvad underviseren sagde."],
      ["Kundemøder", "Produktfakta og priser fra dine egne dokumenter, klar når du har brug for dem."],
    ],
    featuresTitle: "Alt i én app",
    features: [
      ["Læser links for dig", "Hjemmesider, artikler, produktsider og jobopslag hentes automatisk."],
      ["Forstår din kode", "Tilføj GitHub eller upload en zip. Aivia finder den rigtige fil, når spørgsmålet kommer."],
      ["Transskribering i realtid", "Se hvad der bliver sagt, mens det bliver sagt – på dansk, svensk og engelsk."],
      ["Husker din dag", "Spørg bagefter, fx ”hvad sagde læreren om eksamen?”. Tidspunkter og påmindelser foreslås af sig selv.", "notes"],
      ["Lyden gemmes aldrig", "Kun den tekst, du selv vælger at gemme, bliver liggende."],
      ["Virker på mobilen", "Læg Whisper på hjemmeskærmen på iPhone eller Android – ingen download."],
    ],
    pricesTitle: "Priser",
    prices: [
      { name: "Prøveperiode", price: "0 kr", note: "2 dage eller 3 timer. Intet kort." },
      { name: "5 timer", price: "35 kr", note: "Nok til et par møder eller fremlæggelser." },
      { name: "15 timer", price: "85 kr", note: "Mest populær. Rækker langt til job, møder og studier." },
      { name: "40 timer", price: "179 kr", note: "Bedste pris pr. time." },
    ],
    pricesNote:
      "Som et taletidskort: timerne tælles kun ned, når Aivia lytter, og udløber aldrig. Intet abonnement. Priser inkl. moms.",
    faqTitle: "Ofte stillede spørgsmål",
    faq: [
      ["Skal jeg downloade noget?", "Nej. Whisper kører i browseren. På iPhone trykker du Del → Føj til hjemmeskærm, så virker den som en app."],
      ["Hvilke sprog forstår Whisper?", "Dansk, svensk og engelsk – og svarene kommer på samme sprog som samtalen."],
      ["Bliver samtalen gemt?", "Lyden gemmes aldrig. Teksten gemmes kun på din telefon – ikke hos os – til du sletter den."],
      ["Kan Aivia læse mit GitHub?", "Ja. Skriv dit brugernavn eller indsæt et link til et repo, så vælger du, hvilke projekter Aivia skal læse."],
      [
        "Hvorfor ikke bare bruge ChatGPT eller Gemini?",
        "De er gode hjerner, men de ved kun det, du skriver ind, og du skal stoppe op og spørge. Aivia har allerede hørt samtalen, giver dig et kort stikord, når du trykker, og foreslår selv tidspunkter og påmindelser ud fra det, hun har hørt. Brug gerne begge.",
      ],
      ["Hvad sker der efter prøveperioden?", "Der trækkes ikke noget automatisk. Vil du fortsætte, køber du timer, som et taletidskort. De udløber aldrig."],
    ],
    closing: "Din næste vigtige samtale kan blive din bedste.",
    otherLangs: "Andre sprog",
    privacy: "Privatliv og sletning af data",
    madeBy: "Whisper er lavet af Axiom i Aalborg.",
  },
  en: {
    title: "Whisper – AI assistant for meetings, presentations and notes",
    description:
      "Whisper follows your conversations, takes live notes and keeps your own material at hand. One tap gives you a short hint based on the conversation and your documents. Get a summary and reminders afterwards. Try free for 2 days.",
    kicker: "AI assistant for conversations",
    h1: "Your AI assistant for every conversation",
    lead: "Whisper follows the conversation with you. It takes live notes, keeps your own documents, links and code at hand, and with one tap gives you a short hint about what matters right now. Afterwards you get a summary with reminders.",
    cta: "Try it free",
    ctaNote: "2 days free · no card needed",
    whyKicker: "Why Aivia?",
    whyQuote: "ChatGPT is a brain you have to go to. Aivia is the ears that are already there.",
    whyLead:
      "Today's AI is smart but blind: it only knows what you type into it. Aivia already knows what was just said, so she can help without you having to stop and explain.",
    why: [
      ["She was there", "ChatGPT needs everything explained. Aivia already heard the conversation, so she can answer “what did the doctor say?”."],
      ["No typing, no explaining", "You don't have to stop and write a prompt. Tap once on the screen or your earbuds and Aivia gives you a short hint based on what was just said and your own material."],
      ["She notices by herself", "When someone says “your appointment is Thursday at 9”, Aivia offers to add it. You don't even have to remember to ask.", "calendar"],
    ],
    stepsTitle: "How it works",
    steps: [
      ["Prepare", "Upload your notes, slides or documents. Paste links to websites, articles or your GitHub."],
      ["Start", "Start Whisper when the conversation begins. Aivia takes live notes while you focus on the people in front of you."],
      ["Tap", "Need a detail or a figure from your material? Tap, and Aivia gives you a short hint in seconds."],
    ],
    usesTitle: "Built for conversations that matter",
    uses: [
      ["Meetings", "Never miss what was said. Get a summary, decisions and to-dos."],
      ["Presentations", "Keep your own facts and figures at hand when the audience asks follow-up questions."],
      ["Interview prep", "Practise with your CV and the job ad, and get the questions you're likely to be asked."],
      ["Your own code", "Aivia reads your repos and helps you explain what you built, in your own words."],
      ["Lectures and studying", "Upload your notes and let Aivia quiz you. Ask afterwards what the teacher said."],
      ["Customer meetings", "Product details and prices from your own documents, ready when you need them."],
    ],
    featuresTitle: "Everything in one app",
    features: [
      ["Reads links for you", "Websites, articles, product pages and job ads are fetched automatically."],
      ["Understands your code", "Add GitHub or upload a zip. Aivia finds the right file when the question comes."],
      ["Live transcription", "See what is said as it is said, in English, Swedish and Danish."],
      ["Remembers your day", "Ask afterwards, e.g. “what did the teacher say about the exam?”. Times and reminders are suggested by themselves.", "notes"],
      ["Audio is never stored", "Only the text you choose to keep stays."],
      ["Works on your phone", "Add Whisper to your home screen on iPhone or Android – no download."],
    ],
    pricesTitle: "Pricing",
    prices: [
      { name: "Free trial", price: "0 kr", note: "2 days or 3 hours. No card." },
      { name: "5 hours", price: "49 SEK / 35 DKK", note: "Enough for a few meetings or presentations." },
      { name: "15 hours", price: "119 SEK / 85 DKK", note: "Most popular. Goes a long way for work, meetings and study." },
      { name: "40 hours", price: "249 SEK / 179 DKK", note: "Best price per hour." },
    ],
    pricesNote: "Like a prepaid card: hours only count down while Aivia listens and never expire. No subscription. Prices include VAT.",
    faqTitle: "FAQ",
    faq: [
      ["Do I need to download anything?", "No. Whisper runs in the browser. On iPhone tap Share → Add to Home Screen and it works like an app."],
      ["Which languages does Whisper understand?", "English, Swedish and Danish – and answers come in the language of the conversation."],
      ["Is the conversation stored?", "Audio is never stored. The text is only saved on your phone – not with us – until you delete it."],
      ["Can Aivia read my GitHub?", "Yes. Type your username or paste a repo link and pick which projects Aivia should read."],
      [
        "Why not just use ChatGPT or Gemini?",
        "They are great brains, but they only know what you type in, and you have to stop and ask. Aivia already heard the conversation, gives you a short hint when you tap, and suggests times and reminders from what she heard. Feel free to use both.",
      ],
      ["What happens after the trial?", "Nothing is charged automatically. To continue, buy hours like a prepaid card. They never expire."],
    ],
    closing: "Your next important conversation can be your best one.",
    otherLangs: "Other languages",
    privacy: "Privacy and data deletion",
    madeBy: "Whisper is made by Axiom in Aalborg, Denmark.",
  },
};
