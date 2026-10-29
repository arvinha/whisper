import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, isIPv4 } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { ExtractResult, GithubRepo, LinkResult } from "@/lib/shared/types";
import { codeDigest, pickSourcePaths, zipFiles, type SourceFile } from "./code";
import type { LlmConfig } from "./config";
import { AppError, isAbortError } from "./errors";
import { decodeEntities, extractFile, MAX_EXTRACT_CHARS, MAX_ZIP_BYTES, readHtml, tidy } from "./extract";

const MAX_PAGE_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;
const MAX_MAIN_CHARS = 50_000;
const MAX_EXTRA_PAGE_CHARS = 10_000;
const MAX_EXTRA_PAGES = 3;
/** Below this, the page probably needs JavaScript or a login to show its content. */
const MIN_PAGE_CHARS = 200;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Whisper/1.0";
/** On a company's front page, links like these tell what the company does and how it works. */
const ABOUT_LINK = /(om-?oss|om-?os|about|karri[aä]r|karriere|career|jobs?\b|jobb|lediga|vision|v[aä]rderingar|vaerdier|values|culture|kultur|team|company|f[oö]retaget|virksomhed|who-we-are|what-we-do|tj[aä]nster|ydelser|services|produkter|products)/i;

// ---- safe fetching ---------------------------------------------------------------------------

/** Addresses on the server's own machine or network; links must never reach them. */
function privateAddress(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) {
    const rest = v6.slice(7);
    return isIPv4(rest) ? privateAddress(rest) : true;
  }
  return v6 === "::" || v6 === "::1" || /^(fc|fd|fe[89ab]|ff|64:ff9b:)/.test(v6);
}

const blocked = () => new AppError(400, "bad_request", "Den adressen går inte att läsa.");

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup that refuses private addresses, so a link cannot point the server at itself. */
function safeLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    if (addresses.length === 0 || addresses.some((a) => privateAddress(a.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "");
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw blocked();
  if (url.username || url.password) throw blocked();
  if (url.port && url.port !== "80" && url.port !== "443") throw blocked();
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw blocked();
  }
  if (isIP(host) && privateAddress(host)) throw blocked();
}

interface Fetched {
  url: URL;
  status: number;
  type: string;
  body: Buffer;
}

function getOnce(url: URL, signal: AbortSignal, maxBytes: number): Promise<Fetched & { location?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup as never,
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
          "accept-language": "sv,da;q=0.9,en;q=0.8",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          return resolve({ url, status, type: "", body: Buffer.alloc(0), location });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new AppError(400, "bad_request", "Sidan är för stor att läsa."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          let body = Buffer.concat(chunks);
          const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
          try {
            const limit = { maxOutputLength: MAX_PAGE_BYTES * 4 };
            if (encoding === "gzip") body = gunzipSync(body, limit);
            else if (encoding === "deflate") body = inflateSync(body, limit);
            else if (encoding === "br") body = brotliDecompressSync(body, limit);
          } catch {
            return reject(new AppError(400, "bad_request", "Sidan gick inte att packa upp."));
          }
          resolve({ url, status, type: String(res.headers["content-type"] ?? "").toLowerCase(), body });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** GET with redirects, where every hop is checked again. */
async function safeGet(start: URL, signal: AbortSignal, maxBytes = MAX_PAGE_BYTES): Promise<Fetched> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    checkUrl(url);
    let res: Fetched & { location?: string };
    try {
      res = await getOnce(url, signal, maxBytes);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (isAbortError(err)) throw new AppError(504, "timeout", "Sidan svarade inte i tid.");
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EBLOCKED") throw blocked();
      if (code === "ENOTFOUND") throw new AppError(400, "bad_request", "Hittade ingen sida på den adressen. Kontrollera länken.");
      throw new AppError(502, "provider_error", "Kunde inte nå sidan. Kontrollera länken eller försök igen.");
    }
    if (!res.location) return res;
    url = new URL(res.location, url);
  }
  throw new AppError(400, "bad_request", "Sidan skickade vidare för många gånger.");
}

function decodeBody(body: Buffer, type: string): string {
  const declared = /charset=([\w-]+)/.exec(type)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 3000).toString("latin1"))?.[1];
  try {
    return new TextDecoder(declared || "utf-8").decode(body);
  } catch {
    return body.toString("utf8");
  }
}

// ---- web pages -------------------------------------------------------------------------------

function metaContent(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0] ?? "";
  return decodeEntities(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "").trim();
}

function stripTags(html: string): string {
  return tidy(readHtml(html));
}

/** Job sites describe the ad as schema.org JobPosting; it is the cleanest text on the page. */
function jobPosting(html: string): string {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const block of blocks) {
    try {
      const data: unknown = JSON.parse(block.replace(/^<script[^>]*>|<\/script>$/gi, ""));
      const items = (Array.isArray(data) ? data : [data, ...((data as { "@graph"?: unknown[] })?.["@graph"] ?? [])]) as Array<Record<string, unknown>>;
      const job = items.find((item) => item && (item["@type"] === "JobPosting" || (Array.isArray(item["@type"]) && item["@type"].includes("JobPosting"))));
      if (!job) continue;
      const org = job.hiringOrganization as { name?: string } | undefined;
      const place = job.jobLocation as { address?: { addressLocality?: string } } | undefined;
      const lines = [
        `Jobbannons: ${String(job.title ?? "").trim()}`,
        org?.name ? `Arbetsgivare: ${org.name}` : "",
        place?.address?.addressLocality ? `Ort: ${place.address.addressLocality}` : "",
        job.employmentType ? `Anställning: ${String(job.employmentType)}` : "",
        job.validThrough ? `Sista ansökningsdag: ${String(job.validThrough).slice(0, 10)}` : "",
        "",
        stripTags(String(job.description ?? "")),
      ];
      return lines.filter((l, i) => l || i === 5).join("\n").trim();
    } catch {
      // not JSON, or not a job: try the next block
    }
  }
  return "";
}

function mainText(html: string): string {
  const body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  return stripTags(body.replace(/<(nav|footer|aside|form|button|select)[\s\S]*?<\/\1>/gi, ""));
}

function pageTitle(html: string, url: URL): string {
  const title = metaContent(html, "og:title") || decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  return title.replace(/\s+/g, " ").slice(0, 120) || url.hostname.replace(/^www\./, "");
}

function aboutLinks(html: string, base: URL): URL[] {
  const found = new Map<string, URL>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname || url.pathname === base.pathname || url.pathname.length > 80) continue;
    const label = stripTags(match[2]).slice(0, 60);
    const about = ABOUT_LINK.test(url.pathname) || ABOUT_LINK.test(label) || /^\/om([-_/]|$)/i.test(url.pathname) || /^om\s/i.test(label);
    if (!about) continue;
    url.search = "";
    url.hash = "";
    if (!found.has(url.pathname)) found.set(url.pathname, url);
    if (found.size >= MAX_EXTRA_PAGES) break;
  }
  return [...found.values()];
}

export const LINKS_MARK = "\nLänkar på sidan:\n";
const MAX_SITE_LINKS = 40;

/** The site's own links with their labels, so an answer can open the page a question is about. */
function siteLinks(html: string, base: URL): string {
  const found = new Map<string, string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), base);
    } catch {
      continue;
    }
    const sameSite = url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
    if (!sameSite || !/^https?:$/.test(url.protocol) || url.href === base.href || /\.(?:png|jpe?g|gif|svg|webp|css|js|zip)$/i.test(url.pathname)) continue;
    const label = stripTags(match[2]).replace(/\s+/g, " ").trim().slice(0, 50);
    url.hash = "";
    if (label && !found.has(url.href)) found.set(url.href, label);
    if (found.size >= MAX_SITE_LINKS * 2) break;
  }
  // Menu links (careers, about, prices: short paths) before long article links.
  const depth = (href: string) => new URL(href).pathname.split("/").filter(Boolean).length + new URL(href).pathname.length / 100;
  return [...found]
    .sort((a, b) => depth(a[0]) - depth(b[0]))
    .slice(0, MAX_SITE_LINKS)
    .map(([href, label]) => `${label}: ${href}`)
    .join("\n");
}

/**
 * Reads a job ad, a company site (with its about pages) or a PDF behind a link. With `links`,
 * the site's own links follow the text after LINKS_MARK.
 */
export async function readPage(url: URL, vision: LlmConfig | null, signal: AbortSignal, links = false): Promise<ExtractResult> {
  const res = await safeGet(url, signal);
  if (res.status === 401 || res.status === 403 || res.status === 999 || res.status === 429) {
    throw new AppError(
      400,
      "bad_request",
      "Sidan stoppar automatisk läsning (t.ex. LinkedIn kräver inloggning). Kopiera texten i annonsen och välj Klistra in text.",
    );
  }
  if (res.status === 404 || res.status === 410) throw new AppError(400, "bad_request", "Sidan finns inte längre. Annonsen kan vara borttagen.");
  if (res.status >= 400) throw new AppError(400, "bad_request", `Sidan svarade med fel (${res.status}). Försök igen eller klistra in texten.`);

  const fileName = decodeURIComponent(res.url.pathname.split("/").pop() || res.url.hostname);
  if (!res.type.includes("html") && !res.type.startsWith("text/plain")) {
    const doc = await extractFile({ name: fileName, type: res.type.split(";")[0], bytes: res.body }, vision, signal);
    return { ...doc, kind: "web", url: res.url.href };
  }

  const html = decodeBody(res.body, res.type);
  const title = pageTitle(html, res.url);
  const job = jobPosting(html);
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const main = job || mainText(html);
  const parts = [`Webbsida: ${title}`, `Adress: ${res.url.href}`];
  if (description && !main.includes(description.slice(0, 60))) parts.push(`Beskrivning: ${description}`);
  parts.push("", main.slice(0, MAX_MAIN_CHARS));

  // A front page says little on its own; the about and career pages tell what the company is.
  if (!job && res.url.pathname.replace(/\/+$/, "").split("/").filter(Boolean).length <= 1) {
    const extra = await Promise.all(
      aboutLinks(html, res.url).map(async (link) => {
        try {
          const page = await safeGet(link, AbortSignal.any([signal, AbortSignal.timeout(8000)]), 2_000_000);
          if (page.status >= 400 || !page.type.includes("html")) return "";
          const text = mainText(decodeBody(page.body, page.type)).slice(0, MAX_EXTRA_PAGE_CHARS);
          return text.length > 100 ? `=== ${page.url.pathname} ===\n${text}` : "";
        } catch {
          return "";
        }
      }),
    );
    parts.push(...extra.filter(Boolean).map((t) => `\n${t}`));
  }

  const text = tidy(parts.join("\n"));
  if (main.length < MIN_PAGE_CHARS && text.length < MIN_PAGE_CHARS * 2) {
    throw new AppError(
      400,
      "bad_request",
      "Sidan visar nästan ingen text utan inloggning eller JavaScript. Kopiera texten och välj Klistra in text.",
    );
  }
  const truncated = text.length > MAX_EXTRACT_CHARS;
  const linkList = links ? siteLinks(html, res.url) : "";
  return {
    name: job ? (/^Jobbannons: (.+)$/m.exec(job)?.[1] ?? title) : title,
    text: (truncated ? text.slice(0, MAX_EXTRACT_CHARS) : text) + (linkList ? `\n${LINKS_MARK}${linkList}` : ""),
    method: "text",
    truncated,
    kind: "web",
    url: res.url.href,
  };
}

// ---- GitHub ----------------------------------------------------------------------------------

const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

function githubHeaders(): HeadersInit {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  return {
    accept: "application/vnd.github+json",
    "user-agent": "Whisper-Aivia",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function githubApi<T>(path: string, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, { headers: githubHeaders(), signal, cache: "no-store" });
  } catch (err) {
    if (isAbortError(err)) throw new AppError(504, "timeout", "GitHub svarade inte i tid.");
    throw new AppError(502, "provider_error", "Kunde inte nå GitHub just nu.");
  }
  if (res.status === 404) throw new AppError(404, "bad_request", "Hittade inget på GitHub med det namnet. Kontrollera stavningen.");
  if (res.status === 403 || res.status === 429) {
    throw new AppError(429, "rate_limited", "GitHub tillåter inte fler hämtningar just nu. Försök igen om en stund.", { retryAfterSeconds: 60 });
  }
  if (!res.ok) throw new AppError(502, "provider_error", `GitHub svarade med fel (${res.status}).`);
  return (await res.json()) as T;
}

interface GithubRepoJson {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  html_url: string;
  fork: boolean;
  default_branch: string;
  /** KB. */
  size?: number;
  topics?: string[];
  homepage?: string | null;
}

export async function listRepos(user: string, signal: AbortSignal): Promise<GithubRepo[]> {
  const repos = await githubApi<GithubRepoJson[]>(`/users/${user}/repos?per_page=100&sort=pushed&type=owner`, signal);
  return repos
    .filter((r) => !r.fork)
    .map((r) => ({
      name: r.name,
      description: (r.description ?? "").slice(0, 200),
      language: r.language ?? "",
      stars: r.stargazers_count,
      pushedAt: r.pushed_at,
      url: r.html_url,
    }));
}

/** The whole repo as a zip; null when it is too big (usually because of data sets or media). */
async function download(url: string, signal: AbortSignal): Promise<Buffer | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "Whisper-Aivia" }, signal, cache: "no-store" });
  } catch (err) {
    if (isAbortError(err)) throw new AppError(504, "timeout", "GitHub svarade inte i tid.");
    throw new AppError(502, "provider_error", "Kunde inte hämta projektet från GitHub.");
  }
  if (res.status === 404) {
    throw new AppError(404, "bad_request", "Hittade inget öppet repo. Är det privat: ladda ner det som zip på GitHub och ladda upp filen.");
  }
  if (!res.ok || !res.body) throw new AppError(502, "provider_error", `GitHub svarade med fel (${res.status}).`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ZIP_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Enough source to fill a code document several times over, so the digest can pick the best. */
const MAX_PICKED_BYTES = 400_000;
const RAW_PARALLEL = 16;

/** Only the source files of a repo too big to download whole, read one by one. */
async function sourceFiles(
  owner: string,
  repo: string,
  ref: string,
  signal: AbortSignal,
): Promise<{ files: SourceFile[]; paths: string[] }> {
  const tree = await githubApi<{ tree?: Array<{ path: string; type: string; size?: number }> }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    signal,
  );
  const blobs = (tree.tree ?? []).filter((t) => t.type === "blob").map((t) => ({ path: t.path, size: t.size ?? 0 }));
  const paths = pickSourcePaths(blobs, MAX_PICKED_BYTES);
  const files: SourceFile[] = [];
  for (let i = 0; i < paths.length; i += RAW_PARALLEL) {
    const batch = await Promise.all(
      paths.slice(i, i + RAW_PARALLEL).map(async (path): Promise<SourceFile | null> => {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
        const res = await fetch(url, { headers: { "user-agent": "Whisper-Aivia" }, signal, cache: "no-store" }).catch(() => null);
        return res?.ok ? { path, bytes: Buffer.from(await res.arrayBuffer()) } : null;
      }),
    );
    for (const f of batch) if (f) files.push(f);
  }
  if (files.length === 0) {
    throw new AppError(400, "bad_request", "Projektet är för stort att hämta och ingen källkod hittades. Ladda upp en zip med bara källkoden.");
  }
  return { files, paths: blobs.map((b) => b.path) };
}

export async function readRepo(owner: string, repo: string, signal: AbortSignal): Promise<ExtractResult> {
  let meta: GithubRepoJson | null = null;
  try {
    meta = await githubApi<GithubRepoJson>(`/repos/${owner}/${repo}`, signal);
  } catch (err) {
    // Without the details (e.g. GitHub's hourly limit) the code itself can still be read.
    if (err instanceof AppError && err.code !== "rate_limited") throw err;
  }
  const name = meta?.full_name ?? `${owner}/${repo}`;
  const ref = meta?.default_branch ? `refs/heads/${encodeURIComponent(meta.default_branch)}` : "HEAD";
  // GitHub's size (in KB) is the packed history; well above the zip limit, skip straight to the source files.
  const huge = (meta?.size ?? 0) * 1024 > MAX_ZIP_BYTES * 1.5;
  const zip = huge ? null : await download(`https://codeload.github.com/${owner}/${repo}/zip/${ref}`, signal);
  const { files, paths } = zip
    ? { files: zipFiles(zip), paths: undefined }
    : await sourceFiles(owner, repo, meta?.default_branch ?? "HEAD", signal);
  const about = [
    `GitHub: ${meta?.html_url ?? `https://github.com/${owner}/${repo}`}`,
    meta?.description ? `Beskrivning: ${meta.description}` : "",
    meta?.topics?.length ? `Ämnen: ${meta.topics.join(", ")}` : "",
    meta?.homepage ? `Webbplats: ${meta.homepage}` : "",
    meta?.pushed_at ? `Senast uppdaterat: ${meta.pushed_at.slice(0, 10)}` : "",
  ].filter(Boolean);
  const digest = codeDigest(name, files, about, paths);
  return { name, text: digest.text, method: "text", truncated: digest.truncated, kind: "code", url: `https://github.com/${owner}/${repo}` };
}

interface CommitJson {
  sha: string;
  commit: { message: string; author?: { date?: string } | null; committer?: { date?: string } | null };
  files?: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>;
}

const CHANGED_COMMITS = 6;
const DETAILED_COMMITS = 2;
const MAX_FILES_PER_COMMIT = 12;
const MAX_PATCH_CHARS = 1_800;

/** The newest commits of a repo, with changed files and the start of each change for the latest ones. */
export async function recentChanges(owner: string, repo: string, signal: AbortSignal): Promise<string> {
  const commits = await githubApi<CommitJson[]>(`/repos/${owner}/${repo}/commits?per_page=${CHANGED_COMMITS}`, signal);
  const details = await Promise.all(
    commits
      .slice(0, DETAILED_COMMITS)
      .map((c) => githubApi<CommitJson>(`/repos/${owner}/${repo}/commits/${c.sha}`, signal).catch(() => null)),
  );
  const lines = [`GitHub ${owner}/${repo}, newest first:`];
  commits.forEach((c, i) => {
    const date = (c.commit.committer?.date ?? c.commit.author?.date ?? "").replace("T", " ").slice(0, 16);
    lines.push(`- ${date} UTC "${c.commit.message.split("\n")[0].slice(0, 160)}" (${c.sha.slice(0, 7)})`);
    const files = details[i]?.files ?? [];
    let patchChars = 0;
    for (const f of files.slice(0, MAX_FILES_PER_COMMIT)) {
      lines.push(`  ${f.status} ${f.filename} (+${f.additions} -${f.deletions})`);
      if (f.patch && patchChars < MAX_PATCH_CHARS) {
        const part = f.patch.slice(0, MAX_PATCH_CHARS - patchChars);
        patchChars += part.length;
        lines.push(part.split("\n").map((l) => `    ${l}`).join("\n"));
      }
    }
    if (files.length > MAX_FILES_PER_COMMIT) lines.push(`  …and ${files.length - MAX_FILES_PER_COMMIT} more files`);
  });
  return lines.join("\n");
}

// ---- links -----------------------------------------------------------------------------------

export function parseLink(input: string): URL {
  const raw = input.trim();
  if (!raw || raw.length > 2000) throw new AppError(400, "bad_request", "Skriv eller klistra in en länk.");
  // A single word ("arvinha", "@arvinha") is a GitHub username: the help text invites typing just that.
  const user = raw.replace(/^@/, "");
  if (GITHUB_NAME.test(user)) return new URL(`https://github.com/${user}`);
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new AppError(400, "bad_request", "Det ser inte ut som en länk. Kopiera hela adressen från webbläsaren.");
  }
  checkUrl(url);
  if (!url.hostname.includes(".")) throw new AppError(400, "bad_request", "Det ser inte ut som en länk. Kopiera hela adressen från webbläsaren.");
  return url;
}

/** A job ad, a company site, a GitHub profile (to pick repos from) or a GitHub repo. */
export async function readLink(input: string, vision: LlmConfig | null, signal: AbortSignal): Promise<LinkResult> {
  const url = parseLink(input);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "github.com") {
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (owner && GITHUB_NAME.test(owner) && !repo) {
      return { type: "repos", user: owner, repos: await listRepos(owner, signal) };
    }
    const name = repo?.replace(/\.git$/, "");
    if (owner && name && GITHUB_NAME.test(owner) && REPO_NAME.test(name)) {
      return { type: "doc", doc: await readRepo(owner, name, signal) };
    }
  }
  return { type: "doc", doc: await readPage(url, vision, signal) };
}
