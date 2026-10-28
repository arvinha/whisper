import type { AnswerRequest, GithubRepo } from "@/lib/shared/types";
import { AppError } from "./errors";
import { listRepos, parseLink, readPage, readRepo, recentChanges } from "./web";

/** Long enough that a follow-up question reuses the lookup, short enough that a new push shows up. */
const CACHE_MS = 90_000;
const MAX_CACHE = 40;
/** The answer waits for the lookups, so a slow site must not hold it up for long. */
const LOOKUP_MS = 7_000;
const MAX_LINKS = 2;
const PAGE_CHARS = 6_000;
const RECENT_SECONDS = 180;
const RECENT_LINES = 8;

const TLD = "dk|se|no|fi|de|nl|eu|uk|fr|es|com|net|org|io|ai|app|dev|co|nu|tech|info|shop|store|online";
/** Said out loud ("teknikfix punkt dk"); ".se", ".no" and ".de" are also everyday words, so only at the end of a sentence. */
const SPOKEN_TLD = "dk|com|net|org|io|ai|eu|app|dev|tech|shop";

const URL_RE = /https?:\/\/[^\s<>"']+/giu;
const DOMAIN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}@./-])((?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?\\.)+(?:${TLD}))(\\/[^\\s<>"']*)?(?![\\p{L}\\p{N}-])`,
  "giu",
);
const SPOKEN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])([\\p{L}\\p{N}][\\p{L}\\p{N}-]+)\\s+(?:punkt|dot|prik)\\s+((?:${SPOKEN_TLD})(?![\\p{L}\\p{N}])|(?:se|no|de)(?=\\s*[.,!?]*\\s*$))`,
  "giu",
);
const GITHUB_REPO = /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})/;

/** A question about the user's code, so the code itself is fetched from GitHub with line numbers. */
const CODE_QUESTION = /github|\brepo|\bkod|\bcode|\brad\b|\braden\b|\brader\b|\blines?\b|\bfil\b|\bfilen\b|\bfiler\b|\bfiles?\b|funktion|function|\bklass|\bclass|\bmetod|\bmethod|commit|implement/i;
const CODE_CACHE_MS = 10 * 60_000;
const CODE_CHARS = 36_000;
const CODE_REPOS = 2;
const CODE_FILES = 3;
const TREE_PATHS = 80;
const LOGIC_FILE = /\.(?:[cm]?js|jsx|tsx?|py|java|php|go|rs|c|cc|cpp|h|cs|kt|swift|rb|dart|scala|sql)$/i;
const GITHUB_USER = /github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?![A-Za-z0-9-])/gi;
/** Words that say a code question is coming but not which project or file it is about. */
const NOISE = new Set(
  ("kan du din ditt dina mitt min mina vilken vilka vilket och som har hade skrev skrivit gjorde gjort peka visa säga berätta konkret konkreta " +
    "bidragit bidrag mest stolt över github kod koden rad raden rader fil filen filer projekt projektet project code line lines file files " +
    "where which what wrote your show tell about från från eller också just exakt exempel något någon några the and with this that " +
    "gick går där här inte bara själv sjælv kunne hvad hvilken hvor").split(" "),
);

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>, ttl = CACHE_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

/** Websites and GitHub repos mentioned in the last few minutes of the conversation. */
export function mentionedLinks(req: Pick<AnswerRequest, "transcript" | "question">): URL[] {
  const text = [
    ...req.transcript.filter((l) => l.secondsAgo <= RECENT_SECONDS).slice(-RECENT_LINES).map((l) => l.text),
    req.question ?? "",
  ].join("\n");
  const found: string[] = [];
  for (const line of text.split("\n")) {
    found.push(...(line.match(URL_RE) ?? []));
    const withoutUrls = line.replace(URL_RE, " ");
    for (const m of withoutUrls.matchAll(DOMAIN_RE)) found.push(m[0]);
    for (const m of withoutUrls.matchAll(SPOKEN_RE)) found.push(`${m[1]}.${m[2]}`);
  }
  const urls = new Map<string, URL>();
  for (const raw of found) {
    try {
      const url = parseLink(raw.replace(/[.,!?;:)\]]+$/, ""));
      url.hash = "";
      const key = url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/+$/, "");
      if (!urls.has(key)) urls.set(key, url);
    } catch {
      // not a usable link
    }
  }
  return [...urls.values()].slice(-MAX_LINKS);
}

/** Why a lookup failed, in words for the model: the app's own advice (copy, paste…) must never reach the answer. */
function reason(err: unknown): string {
  if (err instanceof AppError && err.code === "timeout") return "the site did not answer in time";
  if (err instanceof AppError && err.code === "rate_limited") return "GitHub allows no more lookups right now";
  return "the site blocks automatic reading, needs a login or could not be reached";
}

function recentText(req: Pick<AnswerRequest, "transcript" | "question">): string {
  return [
    ...req.transcript.filter((l) => l.secondsAgo <= RECENT_SECONDS).slice(-RECENT_LINES).map((l) => l.text),
    req.question ?? "",
  ].join("\n");
}

function terms(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words.filter((w) => !NOISE.has(w)))];
}

/** The user's GitHub name: from their repos in the material, or a github.com link in the material or profile. */
function githubOwner(req: AnswerRequest): string {
  const fromRepos = req.repos?.[0]?.split("/")[0];
  if (fromRepos) return fromRepos;
  for (const text of [req.profile, req.context ?? ""]) {
    for (const m of text.matchAll(GITHUB_USER)) return m[1];
  }
  return "";
}

/** The repos a code question is about: named in it (by name or description), else those in the material, else the newest. */
function pickRepos(all: GithubRepo[], words: string[], prepared: string[]): GithubRepo[] {
  const scored = all
    .map((r) => {
      const about = `${r.name.replace(/[-_.]/g, " ")} ${r.description}`.toLowerCase();
      return { r, score: words.filter((w) => about.includes(w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) return scored.slice(0, CODE_REPOS).map((x) => x.r);
  const fromPrep = prepared.flatMap((name) => all.filter((r) => r.name.toLowerCase() === name.toLowerCase()));
  return (fromPrep.length > 0 ? fromPrep : all).slice(0, CODE_REPOS);
}

/** The files of a repo that fit the question best, with line numbers; source code when nothing matches. */
function pickFiles(digest: string, words: string[], maxChars: number): string {
  const [head, ...sections] = digest.split("\n\n### Fil: ");
  const files = sections.map((s) => {
    const newline = s.indexOf("\n");
    const path = newline < 0 ? s : s.slice(0, newline);
    const body = newline < 0 ? "" : s.slice(newline + 1);
    const lowerPath = path.toLowerCase();
    const lowerBody = body.toLowerCase();
    const score = words.reduce(
      (n, w) => n + (lowerPath.includes(w) ? 5 : 0) + Math.min(5, lowerBody.split(w).length - 1),
      0,
    );
    const logic = LOGIC_FILE.test(path) && body.length >= 300;
    return { path, body, score, logic, rank: score + (logic ? 4 : 0) };
  });
  const matching = files.filter((f) => f.score > 0).sort((a, b) => b.rank - a.rank);
  const largestLogic = files.filter((f) => f.logic).sort((a, b) => b.body.length - a.body.length);
  const chosen = (matching.length > 0 ? matching : largestLogic).slice(0, CODE_FILES);
  if (!chosen.some((f) => f.logic) && largestLogic.length > 0) chosen.splice(CODE_FILES - 1, 1, largestLogic[0]);
  const tree = /Filer \(\d+\):\n([\s\S]*)$/.exec(head)?.[1].split("\n").slice(0, TREE_PATHS).join("\n") ?? "";
  let text = `${head.split("\nFiler (")[0]}\nFiles (first ${TREE_PATHS}):\n${tree}`;
  for (const [i, f] of chosen.entries()) {
    const room = Math.floor((maxChars - text.length) / (chosen.length - i));
    if (room < 500) break;
    text += `\n\n### Fil: ${f.path}\n${numberedExcerpt(f.body, words, room)}`;
  }
  return text;
}

/** The file with its real line numbers; a long file is cut down to the parts around the question's words, or its start. */
function numberedExcerpt(body: string, words: string[], room: number): string {
  const lines = body.split("\n").map((line, i) => `${i + 1}| ${line}`);
  const whole = lines.join("\n");
  if (whole.length <= room) return whole;
  const hits = lines.flatMap((line, i) => (words.some((w) => line.toLowerCase().includes(w)) ? [i] : []));
  if (hits.length === 0) return whole.slice(0, whole.lastIndexOf("\n", room));
  const keep = new Set<number>();
  let size = 0;
  for (const hit of hits) {
    for (let i = Math.max(0, hit - 15); i < Math.min(lines.length, hit + 45); i++) {
      if (keep.has(i)) continue;
      if (size + lines[i].length + 1 > room) break;
      keep.add(i);
      size += lines[i].length + 1;
    }
    if (size >= room - 200) break;
  }
  const out: string[] = [];
  let last = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (last >= 0 && i !== last + 1) out.push("…");
    out.push(lines[i]);
    last = i;
  }
  return out.join("\n");
}

/** The actual code a question about the user's GitHub is about, fetched now, so the answer can name files and lines. */
async function codeLookup(req: AnswerRequest, signal: AbortSignal): Promise<string> {
  const owner = githubOwner(req);
  if (!owner) return "";
  const words = terms(recentText(req));
  const all = await cached(`repos:${owner}`, () => listRepos(owner, signal), CODE_CACHE_MS);
  const prepared = (req.repos ?? []).filter((r) => r.startsWith(`${owner}/`)).map((r) => r.split("/")[1]);
  const repos = pickRepos(all, words, prepared);
  const parts = await Promise.all(
    repos.map(async (r) => {
      try {
        const digest = await cached(`code:${owner}/${r.name}`, async () => (await readRepo(owner, r.name, signal)).text, CODE_CACHE_MS);
        return `Code of ${owner}/${r.name} fetched from GitHub just now${r.description ? ` (${r.description})` : ""}:\n${pickFiles(digest, words, Math.floor(CODE_CHARS / repos.length))}`;
      } catch (err) {
        return `GitHub ${owner}/${r.name}: the code could not be fetched just now (${reason(err)}).`;
      }
    }),
  );
  return parts.join("\n\n");
}

/**
 * Fetches what the answer may need from the internet right now: pages mentioned in the
 * conversation, the newest changes in the user's GitHub repos and, for a question about their
 * code, the code itself. Returns "" when there is nothing.
 */
export async function liveLookups(req: AnswerRequest, signal: AbortSignal): Promise<string> {
  const started = Date.now();
  const repos = new Set(req.repos ?? []);
  const pages: URL[] = [];
  for (const url of mentionedLinks(req)) {
    const repo = url.hostname.replace(/^www\./, "") === "github.com" ? GITHUB_REPO.exec(url.pathname) : null;
    if (repo) repos.add(`${repo[1]}/${repo[2].replace(/\.git$/, "")}`);
    else if (url.hostname.replace(/^www\./, "") !== "github.com") pages.push(url);
  }
  const code = CODE_QUESTION.test(recentText(req));
  if (pages.length === 0 && repos.size === 0 && !code) return "";

  const limit = AbortSignal.any([signal, AbortSignal.timeout(LOOKUP_MS)]);
  const jobs = [
    ...pages.map((url) =>
      cached(`page:${url.href}`, async () => (await readPage(url, null, limit)).text.slice(0, PAGE_CHARS)).then(
        (text) => `Website ${url.href}, read just now:\n${text}`,
        (err: unknown) => `Website ${url.href}: could not be read just now (${reason(err)}).`,
      ),
    ),
    ...[...repos].map((full) => {
      const [owner, name] = full.split("/");
      return cached(`repo:${full}`, () => recentChanges(owner, name, limit)).then(
        (text) => `Newest changes on GitHub, fetched just now:\n${text}`,
        (err: unknown) => `GitHub ${full}: the newest changes could not be fetched just now (${reason(err)}).`,
      );
    }),
    ...(code
      ? [codeLookup(req, limit).catch((err: unknown) => `GitHub: the code could not be fetched just now (${reason(err)}).`)]
      : []),
  ];
  const parts = await Promise.all(jobs);
  console.log(`[psst] live lookups: ${pages.length} pages, ${repos.size} repos, code ${code}, ${Date.now() - started} ms`);
  return parts.filter(Boolean).join("\n\n");
}
