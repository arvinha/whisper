import type { AnswerRequest } from "@/lib/shared/types";
import { AppError } from "./errors";
import { parseLink, readPage, recentChanges } from "./web";

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

const cache = new Map<string, { at: number; value: Promise<string> }>();

function cached(key: string, load: () => Promise<string>): Promise<string> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
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

function reason(err: unknown): string {
  return err instanceof AppError ? err.message : "no answer";
}

/**
 * Fetches what the answer may need from the internet right now: pages mentioned in the
 * conversation and the newest changes in the user's GitHub repos. Returns "" when there is nothing.
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
  if (pages.length === 0 && repos.size === 0) return "";

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
  ];
  const parts = await Promise.all(jobs);
  console.log(`[psst] live lookups: ${pages.length} pages, ${repos.size} repos, ${Date.now() - started} ms`);
  return parts.join("\n\n");
}
