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
const OTHER_TEXT = new Set(["md", "markdown", "txt", "rst", "json", "yml", "yaml", "toml", "xml", "ini", "cfg", "conf", "properties", "env.example", "csv"]);
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
  return e in LANGUAGES || OTHER_TEXT.has(e) || SPECIAL_FILES.has(base);
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

/** Lower comes first: readme, build files, then source code with tests and config last. */
function rank(path: string): number {
  const lower = path.toLowerCase();
  const base = baseName(lower);
  const depth = lower.split("/").length;
  if (/^readme(\.|$)/.test(base) && depth === 1) return 0;
  if (MANIFESTS.includes(base) && depth <= 2) return 1;
  if (/^readme(\.|$)/.test(base)) return 2;
  const e = ext(lower);
  const test = /(^|\/)(tests?|__tests__|spec|e2e)\//.test(lower) || /[._-](test|spec)\.[a-z]+$/.test(base);
  if (e in LANGUAGES && !test) return 3 + Math.min(depth, 6) / 10;
  if (e === "md" || e === "markdown" || e === "rst") return 4;
  if (test) return 5;
  return 6;
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
export function codeDigest(title: string, files: SourceFile[], about: string[] = []): { text: string; truncated: boolean } {
  const kept = files
    .filter((f) => readable(f.path) && f.bytes.length > 0 && f.bytes.length <= MAX_SOURCE_BYTES && !looksBinary(f.bytes))
    .map((f) => ({ path: f.path, size: f.bytes.length, bytes: f.bytes }))
    .sort((a, b) => rank(a.path) - rank(b.path) || a.size - b.size || a.path.localeCompare(b.path));
  if (kept.length === 0) {
    throw new AppError(400, "bad_request", "Hittade ingen kod eller text i projektet.");
  }

  const langs = languageSummary(kept);
  const tree = [...kept.map((f) => f.path)].sort().join("\n");
  const head = [
    `Kodprojekt: ${title}`,
    ...about,
    langs ? `Språk: ${langs}` : "",
    `Filer (${kept.length}):\n${tree.length > MAX_TREE_CHARS ? `${tree.slice(0, MAX_TREE_CHARS)}\n…` : tree}`,
  ]
    .filter(Boolean)
    .join("\n");

  let text = head;
  let truncated = false;
  for (const f of kept) {
    let body = fileText(f.path, f.bytes);
    if (!body.trim()) continue;
    if (body.length > MAX_FILE_CHARS) {
      body = `${body.slice(0, MAX_FILE_CHARS)}\n… (resten av filen utelämnad)`;
      truncated = true;
    }
    const section = `\n\n### Fil: ${f.path}\n${body}`;
    if (text.length + section.length > MAX_CODE_CHARS) {
      truncated = true;
      continue;
    }
    text += section;
  }
  return { text, truncated };
}

/**
 * The files worth reading from a project listing (path and size), most telling first, until
 * `maxBytes`: for repos too big to download whole, e.g. ones that include their data sets.
 */
export function pickSourcePaths(entries: Array<{ path: string; size: number }>, maxBytes: number): string[] {
  const picked: string[] = [];
  let total = 0;
  const sorted = entries
    .filter((e) => readable(e.path) && e.size > 0 && e.size <= MAX_SOURCE_BYTES)
    .sort((a, b) => rank(a.path) - rank(b.path) || a.size - b.size || a.path.localeCompare(b.path));
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
