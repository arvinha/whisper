import { DIGEST_VERSION } from "@/lib/shared/types";
import { AppError } from "./errors";
import { readZip } from "./extract";

/** A code project is kept as one document; the phone picks the parts that fit each question. */
export const MAX_CODE_CHARS = 150_000;
const MAX_FILE_CHARS = 40_000;
const MAX_TREE_CHARS = 6_000;
const MAX_SOURCE_BYTES = 300_000;

const LANGUAGES: Record<string, string> = {
  java: "Java", kt: "Kotlin", kts: "Kotlin", scala: "Scala", groovy: "Groovy", gradle: "Gradle",
  py: "Python", ipynb: "Jupyter", r: "R", jl: "Julia",
  sql: "SQL", prisma: "Prisma",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript", vue: "Vue", svelte: "Svelte", astro: "Astro",
  html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", sass: "SCSS", less: "Less",
  c: "C", h: "C", cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", cs: "C#", fs: "F#", vb: "VB.NET",
  go: "Go", rs: "Rust", rb: "Ruby", php: "PHP", swift: "Swift", m: "Objective-C", dart: "Dart",
  lua: "Lua", pl: "Perl", ex: "Elixir", exs: "Elixir", erl: "Erlang", hs: "Haskell", clj: "Clojure",
  sh: "Shell", bash: "Shell", zsh: "Shell", ps1: "PowerShell", bat: "Batch",
  sol: "Solidity", tf: "Terraform", graphql: "GraphQL", gql: "GraphQL", proto: "Protobuf",
};
/** Readable, but not counted as a programming language. */
const OTHER_TEXT = new Set(["json", "yml", "yaml", "toml", "xml", "ini", "cfg", "conf", "properties", "env.example"]);
/** Written text: readmes, reports, theses and their references, which explain the project in words. */
const PROSE = new Set(["md", "markdown", "txt", "rst", "adoc", "org", "tex", "bib"]);
/** Data sets: a few short samples show their shape; thousands of them would crowd out everything else. */
const DATA = new Set(["csv", "tsv", "jsonl", "ndjson"]);
const DATA_DIRS = new Set(["data", "dataset", "datasets", "raw", "processed", "fixtures", "samples", "sample_data"]);
/** Written documents below the top folder share this; readmes and top-level docs always come along. */
const MAX_PROSE_CHARS = 80_000;
const MAX_DATA_FILES = 8;
const DATA_SAMPLE_LINES = 12;
const DATA_SAMPLE_CHARS = 1_500;
const SPECIAL_FILES = new Set(["dockerfile", "makefile", "procfile", "gemfile", "rakefile", "jenkinsfile", "cmakelists.txt", "requirements.txt", "pipfile"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "out", "target", "bin", "obj", ".next", ".nuxt", ".svelte-kit",
  "vendor", "venv", ".venv", "env", "__pycache__", ".idea", ".vscode", ".gradle", "coverage", "pods", "deriveddata",
  ".dart_tool", ".pub-cache", "bower_components", ".cache", ".parcel-cache", ".turbo", "__macosx", ".terraform",
]);
const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "cargo.lock", "composer.lock", "gemfile.lock",
  "pipfile.lock", "go.sum", "bun.lockb", ".ds_store",
]);
/** What a reader looks at first: the readme, then how the project is built. */
const MANIFESTS = [
  "package.json", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "requirements.txt", "pyproject.toml",
  "setup.py", "pipfile", "cargo.toml", "go.mod", "composer.json", "gemfile", "dockerfile", "docker-compose.yml",
  "docker-compose.yaml", "makefile", "cmakelists.txt", "pubspec.yaml", "angular.json", "next.config.js", "next.config.ts",
  "vite.config.ts", "vite.config.js", "application.properties", "application.yml", "appsettings.json", "schema.prisma",
];

function ext(path: string): string {
  const base = path.toLowerCase().split("/").pop() ?? "";
  if (base.endsWith(".env.example")) return "env.example";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

function baseName(path: string): string {
  return path.toLowerCase().split("/").pop() ?? "";
}

export function isCodeFileName(name: string): boolean {
  const e = ext(name);
  return e in LANGUAGES || SPECIAL_FILES.has(baseName(name));
}

function readable(path: string): boolean {
  const lower = path.toLowerCase();
  const parts = lower.split("/");
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return false;
  const base = parts.at(-1) ?? "";
  if (!base || SKIP_FILES.has(base) || /\.min\.(js|css)$/.test(base) || /\.(map|snap)$/.test(base)) return false;
  const e = ext(lower);
  return e in LANGUAGES || OTHER_TEXT.has(e) || PROSE.has(e) || DATA.has(e) || SPECIAL_FILES.has(base);
}

/** A data file: a table, or json, text or xml inside a data folder. */
function isData(path: string): boolean {
  const lower = path.toLowerCase();
  const e = ext(lower);
  if (DATA.has(e)) return true;
  const dirs = lower.split("/").slice(0, -1);
  return (e === "json" || e === "txt" || e === "xml") && dirs.some((d) => DATA_DIRS.has(d));
}

function isProse(path: string): boolean {
  return PROSE.has(ext(path)) && !isData(path) && !SPECIAL_FILES.has(baseName(path));
}

/** The folder a data file is listed under: its first two folders, so seasons or splits stay apart. */
function dataGroup(path: string): string {
  const dirs = path.split("/").slice(0, -1);
  return dirs.length ? `${dirs.slice(0, 2).join("/")}/` : "./";
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 4000);
  let odd = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) odd++;
  }
  return odd > sample.length * 0.05;
}

/** Jupyter notebooks are JSON; only the cells matter. */
function notebookText(raw: string): string {
  try {
    const nb = JSON.parse(raw) as { cells?: Array<{ cell_type?: string; source?: string | string[] }> };
    return (nb.cells ?? [])
      .map((cell) => {
        const src = Array.isArray(cell.source) ? cell.source.join("") : (cell.source ?? "");
        return cell.cell_type === "markdown" ? src.replace(/^/gm, "# ") : src;
      })
      .filter((s) => s.trim())
      .join("\n\n");
  } catch {
    return raw;
  }
}

function fileText(path: string, buf: Buffer): string {
  const raw = buf.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const text = ext(path) === "ipynb" ? notebookText(raw) : raw;
  return text.replace(/\n{4,}/g, "\n\n\n").trimEnd();
}

/**
 * Lower comes first: readme, build files, written documents (reports, theses, references), source
 * code (what the readme names first), tests, config, and data samples last.
 */
function rank(path: string, named: ReadonlySet<string> = new Set()): number {
  const lower = path.toLowerCase();
  const base = baseName(lower);
  const depth = lower.split("/").length;
  if (/^readme(\.|$)/.test(base) && depth === 1) return 0;
  if (MANIFESTS.includes(base) && depth <= 2) return 1;
  if (isData(lower)) return 9;
  if (isProse(lower)) return 2 + Math.min(depth, 6) / 10;
  const e = ext(lower);
  const test = /(^|\/)(tests?|__tests__|spec|e2e)\//.test(lower) || /[._-](test|spec)\.[a-z]+$/.test(base);
  if (e in LANGUAGES && !test) return (named.has(base) ? 2.9 : 3) + Math.min(depth, 6) / 100;
  if (test) return 5;
  return 6;
}

/** File names the readme mentions, so the code it points to is read first. */
function namedInReadme(files: Array<{ path: string; bytes: Buffer }>): Set<string> {
  const readme = files.find((f) => /^readme(\.|$)/i.test(f.path));
  const text = readme ? readme.bytes.toString("utf8").toLowerCase() : "";
  return new Set(files.map((f) => baseName(f.path)).filter((b) => b.length > 3 && text.includes(b)));
}

/** The file list, with data folders as one line each ("data/2019-20/ … 612 datafiler (csv)"). */
function treeText(paths: string[]): string {
  const lines: string[] = [];
  const groups = new Map<string, { count: number; exts: Set<string> }>();
  for (const path of paths) {
    if (!isData(path)) {
      lines.push(path);
      continue;
    }
    const group = groups.get(dataGroup(path)) ?? { count: 0, exts: new Set<string>() };
    group.count++;
    group.exts.add(ext(path));
    groups.set(dataGroup(path), group);
  }
  for (const [dir, g] of groups) {
    lines.push(g.count === 1 ? `${dir}(1 datafil, ${[...g.exts].join(", ")})` : `${dir} … ${g.count} datafiler (${[...g.exts].join(", ")})`);
  }
  return lines.sort().join("\n");
}

/** One small file from each data folder, folders with few files (results, tables) first. */
function dataSamples<T extends { path: string }>(files: T[]): T[] {
  const byGroup = new Map<string, T[]>();
  for (const f of files) byGroup.set(dataGroup(f.path), [...(byGroup.get(dataGroup(f.path)) ?? []), f]);
  const groups = [...byGroup.values()].sort((a, b) => a.length - b.length);
  const out: T[] = [];
  for (let round = 0; out.length < MAX_DATA_FILES && groups.some((g) => g.length > round); round++) {
    for (const g of groups) {
      // Small folders (a results table or two) are shown whole; big data sets by one example.
      if (out.length >= MAX_DATA_FILES) break;
      if (g.length > round && (round === 0 || g.length <= 3)) out.push(g[round]);
    }
  }
  return out;
}

function sampleText(body: string): string {
  const lines = body.split("\n");
  const head = lines.slice(0, DATA_SAMPLE_LINES).join("\n").slice(0, DATA_SAMPLE_CHARS);
  return lines.length > DATA_SAMPLE_LINES ? `${head}\n… (exempel; ${lines.length - DATA_SAMPLE_LINES} rader till)` : head;
}

function languageSummary(files: Array<{ path: string; size: number }>): string {
  const bytes = new Map<string, number>();
  for (const f of files) {
    const lang = LANGUAGES[ext(f.path)];
    if (lang && lang !== "Gradle") bytes.set(lang, (bytes.get(lang) ?? 0) + f.size);
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  if (!total) return "";
  return [...bytes]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([lang, n]) => `${lang} ${Math.max(1, Math.round((n / total) * 100))} %`)
    .join(", ");
}

export interface SourceFile {
  path: string;
  bytes: Buffer;
}

/**
 * Turns a project's files into one text: name, languages, file tree, then the files themselves
 * as "### Fil: path" sections, most telling first, within MAX_CODE_CHARS.
 */
export function codeDigest(
  title: string,
  files: SourceFile[],
  about: string[] = [],
  allPaths?: string[],
): { text: string; truncated: boolean } {
  const usable = files
    .filter((f) => readable(f.path) && f.bytes.length > 0 && f.bytes.length <= MAX_SOURCE_BYTES && !looksBinary(f.bytes))
    .map((f) => ({ path: f.path, size: f.bytes.length, bytes: f.bytes }));
  const named = namedInReadme(usable);
  const byRank = (a: { path: string; size: number }, b: { path: string; size: number }) =>
    rank(a.path, named) - rank(b.path, named) || a.size - b.size || a.path.localeCompare(b.path);
  const data = usable.filter((f) => isData(f.path));
  const kept = [...usable.filter((f) => !isData(f.path)), ...dataSamples(data.sort(byRank))].sort(byRank);
  if (kept.length === 0) {
    throw new AppError(400, "bad_request", "Hittade ingen kod eller text i projektet.");
  }

  const langs = languageSummary(usable);
  const listed = (allPaths ?? usable.map((f) => f.path)).filter(readable);
  const tree = treeText(listed);
  const head = [
    `Kodprojekt: ${title}`,
    ...about,
    langs ? `Språk: ${langs}` : "",
    DIGEST_VERSION,
    `Filer (${listed.length}):\n${tree.length > MAX_TREE_CHARS ? `${tree.slice(0, tree.lastIndexOf("\n", MAX_TREE_CHARS))}\n…` : tree}`,
  ]
    .filter(Boolean)
    .join("\n");

  let text = head;
  let truncated = data.length > MAX_DATA_FILES;
  let prose = 0;
  for (const f of kept) {
    let body = fileText(f.path, f.bytes);
    if (!body.trim()) continue;
    if (isData(f.path)) body = sampleText(body);
    if (body.length > MAX_FILE_CHARS) {
      body = `${body.slice(0, MAX_FILE_CHARS)}\n… (resten av filen utelämnad)`;
      truncated = true;
    }
    if (isProse(f.path) && depthOf(f.path) > 1 && prose + body.length > MAX_PROSE_CHARS) {
      truncated = true;
      continue;
    }
    const room = MAX_CODE_CHARS - text.length - f.path.length - 20;
    if (body.length > room) {
      truncated = true;
      // The start of a big file says more than nothing; small leftovers are skipped.
      if (room < 3_000) continue;
      body = `${body.slice(0, body.lastIndexOf("\n", room - 60))}\n… (resten av filen utelämnad)`;
    }
    if (isProse(f.path)) prose += body.length;
    text += `\n\n### Fil: ${f.path}\n${body}`;
  }
  return { text, truncated };
}

function depthOf(path: string): number {
  return path.split("/").length;
}

/**
 * The files worth reading from a project listing (path and size), most telling first, until
 * `maxBytes`: for repos too big to download whole, e.g. ones that include their data sets.
 */
export function pickSourcePaths(entries: Array<{ path: string; size: number }>, maxBytes: number): string[] {
  const picked: string[] = [];
  let total = 0;
  const usable = entries.filter((e) => readable(e.path) && e.size > 0 && e.size <= MAX_SOURCE_BYTES);
  const byRank = (a: { path: string; size: number }, b: { path: string; size: number }) =>
    rank(a.path) - rank(b.path) || a.size - b.size || a.path.localeCompare(b.path);
  const sorted = [...usable.filter((e) => !isData(e.path)).sort(byRank), ...dataSamples(usable.filter((e) => isData(e.path)).sort(byRank))];
  for (const e of sorted) {
    if (total + e.size > maxBytes) continue;
    picked.push(e.path);
    total += e.size;
  }
  return picked;
}

/** The files in a zip, without the single top folder GitHub and most zip tools add. */
export function zipFiles(buf: Buffer): SourceFile[] {
  const entries = readZip(buf);
  // Some Windows tools write "\" between folders.
  const names = [...entries.keys()].filter((n) => !/[\\/]$/.test(n)).map((n) => [n, n.replace(/\\/g, "/")] as const);
  if (names.length === 0) throw new AppError(400, "bad_request", "Zip-filen är tom.");
  const first = names[0][1].split("/")[0];
  const prefix = names.every(([, n]) => n.startsWith(`${first}/`)) ? `${first}/` : "";
  const out: SourceFile[] = [];
  for (const [name, normalized] of names) {
    const path = normalized.slice(prefix.length);
    if (!readable(path)) continue;
    const bytes = entries.get(name)!();
    if (bytes.length > 0) out.push({ path, bytes });
  }
  return out;
}

/** A single source file (Main.java, queries.sql…) as a small code document. */
export function singleFileDigest(name: string, buf: Buffer): string {
  const body = fileText(name, buf);
  if (!body.trim()) throw new AppError(400, "bad_request", "Filen är tom.");
  const lang = LANGUAGES[ext(name)] ?? "";
  return `Kodfil: ${name}${lang ? ` (${lang})` : ""}\n\n### Fil: ${name}\n${body.slice(0, MAX_CODE_CHARS - 200)}`;
}
