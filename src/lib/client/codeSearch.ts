import type { Prep, PrepDoc } from "./preps";

/** Marks the start of each file in a code document (see the server's code.ts). */
export const FILE_MARK = "\n\n### Fil: ";
const CHUNK_CHARS = 1800;
const MAX_CHUNKS = 5;

interface Chunk {
  doc: string;
  path: string;
  text: string;
  lower: string;
  pathLower: string;
}

const STOP = new Set(
  (
    "och att det som för med den har inte till var jag ett kan han hon vad men eller från här där när hur vilken vilket " +
    "vilka också bara mycket alltså liksom typ kanske skulle borde någon något några dig mig sig din ditt dina min mitt " +
    "mina era våra vår ert berätta berättar säg tycker tror vill ska skall gjorde gjort göra gör använde använt använda " +
    "jobbat jobbade projekt projektet arbete arbetet exempel lite mer mest väldigt fråga frågan svar svaret " +
    "og at det som for med den har ikke til var jeg kan han hun hvad men eller fra her der når hvordan hvilken også " +
    "bare meget noget nogle dig mig sig din dit dine min mit mine fortæl fortælle synes tror vil skal gjorde gjort gøre " +
    "brugte bruge projektet arbejde eksempel lidt mere " +
    "the and that this with for you your was were are have has had what why how which who when where about tell " +
    "did does done use used using project work some more most very can could would should will just like they them " +
    "there their from into been being also any example question answer please"
  ).split(" "),
);

/** Spoken words (often Swedish or Danish) and the words they appear as in code. */
const SYNONYMS: Array<[RegExp, string[]]> = [
  [/^(databas|databasen|databaser|database|databasen?e?)$/, ["database", "sql", "table", "query", "repository"]],
  [/^(tabell|tabellen|tabeller|tabel|tabellerne)$/, ["table", "create", "schema"]],
  [/^(inloggning|inloggningen|logga|login|logge|autentisering|godkendelse)$/, ["login", "auth", "password", "session", "token"]],
  [/^(säkerhet|säkerheten|sikkerhed|security)$/, ["security", "auth", "hash", "encrypt", "token"]],
  [/^(test|tester|testa|testade|testning|tests|testing)$/, ["test", "assert", "expect", "mock"]],
  [/^(betalning|betalningen|betalningar|betala|betalt|betaling|betalingen|betalinger|betale|payment)$/, ["payment", "betaling", "betalning", "stripe", "checkout", "order"]],
  [/^(kvitto|kvittot|kvitton|kvittering|kvitteringen|receipt)$/, ["receipt", "kvittering", "kvitto", "invoice"]],
  [/^(mejl|mejla|mail|mailen|mejlet|e-post|epost|email)$/, ["mail", "email", "send", "resend", "smtp"]],
  [/^(sms|sms:et|meddelande|besked)$/, ["sms", "notify", "message"]],
  [/^(användare|användaren|användarna|bruger|brugere|brugeren)$/, ["user", "account"]],
  [/^(sökning|söka|søgning|søge|search)$/, ["search", "query", "filter"]],
  [/^(prestanda|ydeevne|snabbare|hurtigere|performance)$/, ["performance", "cache", "index", "async"]],
  [/^(arkitektur|arkitekturen|architecture|struktur|strukturen)$/, ["controller", "service", "repository", "model", "module"]],
  [/^(felhantering|fejlhåndtering|fel|felet|fejl|fejlen|error|errors)$/, ["error", "exception", "catch", "throw"]],
  [/^(gränssnitt|gränssnittet|brugerflade|frontend)$/, ["component", "view", "page", "render"]],
  [/^(server|servern|serveren|backend)$/, ["server", "controller", "route", "service", "api"]],
  [/^(endpoint|endpoints|anrop|kald)$/, ["route", "endpoint", "controller", "fetch", "request"]],
  [/^(klass|klassen|klasser|klasse|klassen)$/, ["class"]],
  [/^(funktion|funktionen|funktioner|metod|metoden|metode)$/, ["function", "def", "method"]],
];

const chunkCache = new Map<string, Chunk[]>();

function chunksOf(doc: PrepDoc): Chunk[] {
  const cached = chunkCache.get(doc.id);
  if (cached) return cached;
  const out: Chunk[] = [];
  for (const section of doc.text.split(FILE_MARK).slice(1)) {
    const newline = section.indexOf("\n");
    const path = (newline < 0 ? section : section.slice(0, newline)).trim();
    const body = newline < 0 ? "" : section.slice(newline + 1);
    let piece = "";
    const push = () => {
      if (piece.trim()) out.push({ doc: doc.name, path, text: piece, lower: piece.toLowerCase(), pathLower: path.toLowerCase() });
      piece = "";
    };
    for (const line of body.split("\n")) {
      if (piece.length + line.length > CHUNK_CHARS && piece) push();
      piece += `${line.slice(0, CHUNK_CHARS)}\n`;
    }
    push();
  }
  chunkCache.set(doc.id, out);
  if (chunkCache.size > 40) chunkCache.delete(chunkCache.keys().next().value!);
  return out;
}

function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [];
  const out = new Set<string>();
  for (const word of words) {
    if (STOP.has(word)) continue;
    // Spoken words come inflected ("kvittot", "databasen"); the stem also finds "kvittering".
    out.add(word.length > 6 ? word.slice(0, Math.max(5, word.length - 3)) : word);
    for (const [re, extra] of SYNONYMS) if (re.test(word)) extra.forEach((e) => out.add(e));
  }
  return [...out].slice(0, 40);
}

function count(haystack: string, needle: string, cap: number): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0 && n < cap; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/**
 * The parts of the user's code projects that best match what is being said, for one answer.
 * Plain word matching (with a few spoken-word synonyms) is fast enough to run on every question.
 */
export function codeSnippets(prep: Prep | null, query: string, maxChars: number): string {
  if (!prep || maxChars <= 0) return "";
  const chunks = prep.docs.filter((d) => d.kind === "code").flatMap(chunksOf);
  if (chunks.length === 0) return "";
  const terms = queryTerms(query);
  if (terms.length === 0) return "";

  const total = chunks.length;
  const weights = new Map<string, number>();
  for (const term of terms) {
    const df = chunks.reduce((n, c) => n + (c.lower.includes(term) || c.pathLower.includes(term) ? 1 : 0), 0);
    // A word in most of the code (e.g. "public") says nothing about which part is meant.
    if (df === 0 || (total > 8 && df / total > 0.5)) continue;
    weights.set(term, Math.log((total + 1) / (df + 0.5)));
  }
  if (weights.size === 0) return "";

  const scored = chunks
    .map((chunk) => {
      let score = 0;
      for (const [term, weight] of weights) {
        const tf = count(chunk.lower, term, 6);
        if (tf > 0) score += (1 + Math.log(tf)) * weight;
        if (chunk.pathLower.includes(term)) score += 2 * weight;
      }
      return { chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHUNKS);

  let text = "";
  for (const { chunk } of scored) {
    const part = `### Fil: ${chunk.path} (${chunk.doc})\n${chunk.text.trimEnd()}\n\n`;
    if (text.length + part.length > maxChars) {
      if (!text) text = part.slice(0, maxChars);
      break;
    }
    text += part;
  }
  return text.trim();
}

/** Readme, build files and file tree: the start of a code document. */
export function codeOverview(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  return `${text.slice(0, cut > maxChars / 2 ? cut : maxChars)}\n… (fler filer finns; de som passar frågan skickas med)`;
}
