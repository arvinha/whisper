/**
 * Word search over the user's material: documents, theses, references and every file of their code
 * projects. Runs on the phone for each question and on the server as the deep answer's search tool.
 */

/** Marks the start of each file in a code document (see the server's code.ts). */
export const FILE_MARK = "\n\n### Fil: ";

export interface SearchDoc {
  name: string;
  text: string;
}

interface Chunk {
  doc: string;
  /** File path in a code project, or "" for a document. */
  path: string;
  /** Where in the file or document: "rad 40–79" or "del 3 av 12". */
  where: string;
  text: string;
  lower: string;
  pathLower: string;
}

const CODE_WINDOW_LINES = 40;
const CODE_STEP_LINES = 30;
const TEXT_WINDOW_CHARS = 1_400;
const TEXT_STEP_CHARS = 1_000;

const STOP = new Set(
  (
    "och att det som för med den har inte till var jag ett kan han hon vad men eller från här där när hur vilken vilket " +
    "vilka också bara mycket alltså liksom typ kanske skulle borde någon något några dig mig sig din ditt dina min mitt " +
    "mina era våra vår ert berätta berättar säg tycker tror vill ska skall gjorde gjort göra gör använde använt använda " +
    "jobbat jobbade arbete arbetet exempel lite mer mest väldigt fråga frågan svar svaret " +
    "og at det som for med den har ikke til var jeg kan han hun hvad men eller fra her der når hvordan hvilken også " +
    "bare meget noget nogle dig mig sig din dit dine min mit mine fortæl fortælle synes tror vil skal gjorde gjort gøre " +
    "brugte bruge arbejde eksempel lidt mere " +
    "the and that this with for you your was were are have has had what why how which who when where about tell " +
    "did does done use used using work some more most very can could would should will just like they them " +
    "there their from into been being also any example question answer please"
  ).split(" "),
);

/** Spoken words (often Swedish or Danish) and the words they appear as in the material. */
const SYNONYMS: Array<[RegExp, string[]]> = [
  [/^(källa|källan|källor|källorna|kilde|kilden|kilder|source|sources)$/, ["source", "dataset", "repository", "reference", "cite", "källa", "kilde"]],
  [/^(data|datan|datat|datamängd|datamängden|datasetet|dataset|datasæt|datasættet)$/, ["data", "dataset", "source"]],
  [/^(hittade|hitta|hämtade|hämta|fick|fandt|finde|hentede|hente|found|find|got)$/, ["source", "dataset", "download", "collect", "scrape", "repository"]],
  [/^(kredit|krediterade|kreditera|krediterat|credit|credited|citerade|citera|refererade|referera|nämnde|angav|krediterede)$/, ["cite", "credit", "reference", "acknowledg", "bib"]],
  [/^(referens|referenser|referenserna|referencer|reference|references|litteratur|litteraturen|bibliografi)$/, ["reference", "cite", "bib", "bibliography"]],
  [/^(uppsats|uppsatsen|examensarbete|examensarbetet|kandidatarbete|exjobb|exjobbet|kex|afhandling|speciale|thesis)$/, ["thesis", "chapter", "section", "abstract"]],
  [/^(resultat|resultaten|resultatet|results|result)$/, ["result", "metric", "mae", "rmse", "table"]],
  [/^(metod|metoden|metodik|metode|metoden|method|methodology)$/, ["method", "methodology", "approach", "pipeline"]],
  [/^(modell|modellen|modeller|model|models)$/, ["model", "train", "predict", "regressor"]],
  [/^(databas|databasen|databaser|database)$/, ["database", "sql", "table", "query", "repository"]],
  [/^(tabell|tabellen|tabeller|tabel|tabellerne)$/, ["table", "create", "schema"]],
  [/^(inloggning|inloggningen|logga|login|logge|autentisering|godkendelse)$/, ["login", "auth", "password", "session", "token"]],
  [/^(säkerhet|säkerheten|sikkerhed|security)$/, ["security", "auth", "hash", "encrypt", "token"]],
  [/^(test|tester|testa|testade|testning|tests|testing)$/, ["test", "assert", "expect", "mock"]],
  [/^(betalning|betalningen|betalningar|betala|betalt|betaling|betalingen|betalinger|betale|payment)$/, ["payment", "betaling", "betalning", "stripe", "checkout", "order"]],
  [/^(kvitto|kvittot|kvitton|kvittering|kvitteringen|receipt)$/, ["receipt", "kvittering", "kvitto", "invoice"]],
  [/^(mejl|mejla|mail|mailen|mejlet|e-post|epost|email)$/, ["mail", "email", "send", "resend", "smtp"]],
  [/^(sms|meddelande|besked)$/, ["sms", "notify", "message"]],
  [/^(endpoint|endpoints|anrop|kald)$/, ["route", "endpoint", "controller", "fetch", "request"]],
  [/^(användare|användaren|användarna|bruger|brugere|brugeren)$/, ["user", "account"]],
  [/^(sökning|söka|søgning|søge|search)$/, ["search", "query", "filter"]],
  [/^(prestanda|ydeevne|snabbare|hurtigere|performance)$/, ["performance", "cache", "index", "async"]],
  [/^(arkitektur|arkitekturen|architecture|struktur|strukturen)$/, ["controller", "service", "repository", "model", "module"]],
  [/^(felhantering|fejlhåndtering|fel|felet|fejl|fejlen|error|errors)$/, ["error", "exception", "catch", "throw"]],
  [/^(gränssnitt|gränssnittet|brugerflade|frontend)$/, ["component", "view", "page", "render"]],
  [/^(server|servern|serveren|backend)$/, ["server", "controller", "route", "service", "api"]],
  [/^(klass|klassen|klasser|klasse)$/, ["class"]],
  [/^(funktion|funktionen|funktioner|metod|metoden|metode)$/, ["function", "def", "method"]],
];

function codeChunks(name: string, text: string): Chunk[] {
  const out: Chunk[] = [];
  for (const section of text.split(FILE_MARK).slice(1)) {
    const newline = section.indexOf("\n");
    const path = (newline < 0 ? section : section.slice(0, newline)).trim();
    const lines = newline < 0 ? [] : section.slice(newline + 1).split("\n");
    for (let start = 0; start < lines.length; start += CODE_STEP_LINES) {
      const window = lines.slice(start, start + CODE_WINDOW_LINES);
      const body = window.map((line, i) => `${start + i + 1}| ${line.slice(0, 400)}`).join("\n");
      if (!window.join("").trim()) continue;
      const end = start + window.length;
      out.push({ doc: name, path, where: `rad ${start + 1}–${end}`, text: body, lower: body.toLowerCase(), pathLower: path.toLowerCase() });
      if (end >= lines.length) break;
    }
  }
  // The project's head (name, description, file list) is searchable too.
  const head = text.split(FILE_MARK)[0];
  if (head.trim()) out.push({ doc: name, path: "", where: "översikt", text: head.slice(0, 6_000), lower: head.slice(0, 6_000).toLowerCase(), pathLower: "" });
  return out;
}

function textChunks(name: string, text: string): Chunk[] {
  const out: Chunk[] = [];
  const parts = Math.max(1, Math.ceil((text.length - TEXT_WINDOW_CHARS) / TEXT_STEP_CHARS) + 1);
  for (let i = 0, start = 0; start < text.length; i++, start += TEXT_STEP_CHARS) {
    // Start at a line break where there is one nearby, so passages begin with a whole line.
    const newline = start === 0 ? -1 : text.lastIndexOf("\n", start);
    const from = newline >= start - 200 && newline >= 0 ? newline + 1 : start;
    const body = text.slice(from, from + TEXT_WINDOW_CHARS);
    if (body.trim()) out.push({ doc: name, path: "", where: `del ${i + 1} av ${parts}`, text: body, lower: body.toLowerCase(), pathLower: "" });
    if (from + TEXT_WINDOW_CHARS >= text.length) break;
  }
  return out;
}

const chunkCache = new Map<string, Chunk[]>();

function chunksOf(doc: SearchDoc): Chunk[] {
  const key = `${doc.name}|${doc.text.length}|${doc.text.slice(0, 200)}|${doc.text.slice(-200)}`;
  const cached = chunkCache.get(key);
  if (cached) return cached;
  const chunks = doc.text.includes(FILE_MARK) ? codeChunks(doc.name, doc.text) : textChunks(doc.name, doc.text);
  chunkCache.set(key, chunks);
  if (chunkCache.size > 60) chunkCache.delete(chunkCache.keys().next().value!);
  return chunks;
}

export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  const out = new Set<string>();
  for (const word of words) {
    if (STOP.has(word) || (word.length < 3 && !/\d/.test(word))) continue;
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

/** Quoted words or a few words in a row the user may have said exactly ("expected goals"). */
function phrases(query: string): string[] {
  const quoted = [...query.matchAll(/["“”']([^"“”']{3,60})["“”']/g)].map((m) => m[1].toLowerCase().trim());
  return quoted.length ? quoted : [];
}

/**
 * The passages that best match `query` (BM25-like word weights, with file names and exact phrases
 * counting extra), as text within `maxChars`. "" when nothing matches.
 */
export function searchMaterial(docs: SearchDoc[], query: string, maxChars: number, maxHits = 6): string {
  if (maxChars <= 0) return "";
  const chunks = docs.flatMap(chunksOf);
  if (chunks.length === 0) return "";
  const terms = queryTerms(query);
  const exact = phrases(query);
  if (terms.length === 0 && exact.length === 0) return "";

  const total = chunks.length;
  const avgLength = chunks.reduce((n, c) => n + c.text.length, 0) / total;
  const weights = new Map<string, number>();
  for (const term of terms) {
    const df = chunks.reduce((n, c) => n + (c.lower.includes(term) || c.pathLower.includes(term) ? 1 : 0), 0);
    // A word in most of the material (e.g. "public") says nothing about which part is meant.
    if (df === 0 || (total > 8 && df / total > 0.5)) continue;
    weights.set(term, Math.log(1 + (total - df + 0.5) / (df + 0.5)));
  }
  if (weights.size === 0 && exact.length === 0) return "";

  const scored = chunks
    .map((chunk) => {
      let score = 0;
      const norm = 1 - 0.75 + 0.75 * (chunk.text.length / avgLength);
      for (const [term, weight] of weights) {
        const tf = count(chunk.lower, term, 8);
        if (tf > 0) score += weight * ((tf * 2.2) / (tf + 1.2 * norm));
        if (chunk.pathLower.includes(term)) score += 1.5 * weight;
      }
      for (const p of exact) if (chunk.lower.includes(p)) score += 6;
      return { chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  let text = "";
  const used: Chunk[] = [];
  for (const { chunk } of scored) {
    if (used.length >= maxHits) break;
    // Many windows of one file or document would crowd out the other places it is mentioned.
    if (used.filter((u) => u.doc === chunk.doc && u.path === chunk.path).length >= 2) continue;
    const label = chunk.path ? `### Fil: ${chunk.path} (${chunk.doc}, ${chunk.where})` : `### ${chunk.doc} (${chunk.where})`;
    const part = `${label}\n${chunk.text.trimEnd()}\n\n`;
    if (text.length + part.length > maxChars) {
      if (!text) text = part.slice(0, maxChars);
      break;
    }
    text += part;
    used.push(chunk);
  }
  return text.trim();
}
