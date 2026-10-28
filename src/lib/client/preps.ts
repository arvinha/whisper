import { useSyncExternalStore } from "react";
import { DIGEST_VERSION, type PrepBrief, type PrepDocKind, type PrepKind } from "@/lib/shared/types";
import { codeOverview, FILE_MARK, materialSnippets } from "./codeSearch";
import { getT } from "./i18n";
import { onOwnerChange, ownedKey } from "./owner";

export interface PrepDoc {
  id: string;
  name: string;
  text: string;
  addedAt: number;
  /** The text was read by the AI model (photo or scan), so it may contain reading errors. */
  ai: boolean;
  truncated: boolean;
  /** Missing on documents saved before code and links were supported: those are "doc". */
  kind?: PrepDocKind;
  url?: string;
}

/** Material for one upcoming situation: an interview, a meeting, a presentation… */
export interface Prep {
  id: string;
  kind: PrepKind;
  title: string;
  notes: string;
  docs: PrepDoc[];
  brief: PrepBrief | null;
  /** `contentKey` of the prep when the brief was made; a different key means it is out of date. */
  briefKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface PrepState {
  preps: Prep[];
  /** The prep whose material goes with every answer. */
  activeId: string | null;
}

const KIND_ENGLISH: Record<PrepKind, string> = {
  interview: "Job interview",
  meeting: "Meeting",
  presentation: "Presentation the user gives",
  exam: "Oral exam or test",
  sales: "Sales or customer meeting",
  other: "Conversation",
};

const STORAGE_KEY = "psst.preps.v1";
const MAX_PREPS = 12;
/** A whole thesis or report, so its reference list at the end is kept. */
export const MAX_DOC_CHARS = 150_000;
/** A whole code project; only the parts that match each question go with an answer. */
export const MAX_CODE_DOC_CHARS = 150_000;
export const MAX_PREP_TOTAL_CHARS = 500_000;
/** How much of a code project goes with every answer and into the brief: readme, build files, tree. */
const CODE_OVERVIEW_CHARS = 8_000;
const CODE_BRIEF_CHARS = 30_000;
const EMPTY: PrepState = { preps: [], activeId: null };

let current: PrepState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  onOwnerChange(() => {
    loaded = false;
    current = EMPTY;
    listeners.forEach((l) => l());
  });
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  const key = ownedKey(STORAGE_KEY);
  if (!key) return;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw) as Partial<PrepState>;
    const preps = Array.isArray(data.preps)
      ? data.preps.filter((p) => p && typeof p.id === "string" && Array.isArray(p.docs))
      : [];
    current = { preps, activeId: preps.some((p) => p.id === data.activeId) ? (data.activeId ?? null) : null };
  } catch {
    current = EMPTY;
  }
}

/** Returns false when the phone's storage is full; the change is then kept in memory only. */
function persist(next: PrepState): boolean {
  current = next;
  let ok = true;
  try {
    const key = ownedKey(STORAGE_KEY);
    if (key) window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    ok = false;
  }
  listeners.forEach((l) => l());
  return ok;
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function getPrepState(): PrepState {
  load();
  return current;
}

export function getActivePrep(): Prep | null {
  const s = getPrepState();
  return s.preps.find((p) => p.id === s.activeId) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const subscribePreps = subscribe;

export function usePreps(): PrepState {
  return useSyncExternalStore(subscribe, getPrepState, () => EMPTY);
}

export function createPrep(kind: PrepKind = "interview"): Prep {
  load();
  const now = Date.now();
  const prep: Prep = { id: newId(), kind, title: "", notes: "", docs: [], brief: null, briefKey: "", createdAt: now, updatedAt: now };
  persist({ preps: [prep, ...current.preps].slice(0, MAX_PREPS), activeId: prep.id });
  return prep;
}

export function updatePrep(id: string, patch: Partial<Omit<Prep, "id" | "createdAt">>): boolean {
  load();
  return persist({
    ...current,
    preps: current.preps.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
  });
}

export function deletePrep(id: string) {
  load();
  persist({
    preps: current.preps.filter((p) => p.id !== id),
    activeId: current.activeId === id ? null : current.activeId,
  });
}

export function setActivePrep(id: string | null) {
  load();
  persist({ ...current, activeId: id });
}

export function prepChars(prep: Prep): number {
  return prep.docs.reduce((n, d) => n + d.text.length, 0);
}

/** Adds a document; returns an error message if it does not fit. */
export function addDoc(
  id: string,
  doc: { name: string; text: string; ai?: boolean; truncated?: boolean; kind?: PrepDocKind; url?: string },
): string | null {
  const t = getT().prep;
  const prep = getPrepState().preps.find((p) => p.id === id);
  if (!prep) return t.gone;
  const room = MAX_PREP_TOTAL_CHARS - prepChars(prep);
  if (room < 200) return t.full;
  const text = doc.text.slice(0, Math.min(doc.kind === "code" ? MAX_CODE_DOC_CHARS : MAX_DOC_CHARS, room));
  const entry: PrepDoc = {
    id: newId(),
    name: doc.name.slice(0, 120) || "Text",
    text,
    addedAt: Date.now(),
    ai: !!doc.ai,
    truncated: !!doc.truncated || text.length < doc.text.length,
    kind: doc.kind ?? "doc",
    ...(doc.url ? { url: doc.url.slice(0, 500) } : {}),
  };
  const ok = updatePrep(id, { docs: [...prep.docs, entry] });
  return ok ? null : t.storageFull;
}

/** GitHub projects read by an older reader (see DIGEST_VERSION), in all of this person's preps. */
export function staleRepos(): Array<{ prepId: string; docId: string; url: string }> {
  return getPrepState().preps.flatMap((p) =>
    p.docs
      .filter((d) => d.kind === "code" && d.url?.startsWith("https://github.com/") && !d.text.includes(DIGEST_VERSION))
      .map((d) => ({ prepId: p.id, docId: d.id, url: d.url! })),
  );
}

/** Puts a newer reading of a document in place of the old one, keeping its place and id. */
export function replaceDocText(id: string, docId: string, doc: { text: string; truncated?: boolean }) {
  const prep = getPrepState().preps.find((p) => p.id === id);
  const old = prep?.docs.find((d) => d.id === docId);
  if (!prep || !old) return;
  const room = MAX_PREP_TOTAL_CHARS - prepChars(prep) + old.text.length;
  const text = doc.text.slice(0, Math.min(old.kind === "code" ? MAX_CODE_DOC_CHARS : MAX_DOC_CHARS, room));
  const fresh = { ...old, text, truncated: !!doc.truncated || text.length < doc.text.length };
  updatePrep(id, { docs: prep.docs.map((d) => (d.id === docId ? fresh : d)) });
}

export function removeDoc(id: string, docId: string) {
  const prep = getPrepState().preps.find((p) => p.id === id);
  if (prep) updatePrep(id, { docs: prep.docs.filter((d) => d.id !== docId) });
}

/** Changes whenever what the brief is based on changes (renaming does not count). */
export function contentKey(prep: Pick<Prep, "kind" | "notes" | "docs">): string {
  return [prep.kind, prep.notes, ...prep.docs.map((d) => d.id)].join("|");
}

function briefText(brief: PrepBrief): string {
  const out: string[] = [];
  if (brief.pitch) out.push(`How the user presents themselves: ${brief.pitch}`);
  if (brief.facts.length) out.push(`Key facts:\n${brief.facts.map((f) => `- ${f}`).join("\n")}`);
  if (brief.questions.length) {
    out.push(
      `Likely questions with the user's prepared answers:\n${brief.questions.map((q) => `Q: ${q.q}\nA: ${q.a}`).join("\n")}`,
    );
  }
  if (brief.askThem.length) out.push(`Questions the user can ask:\n${brief.askThem.map((q) => `- ${q}`).join("\n")}`);
  if (brief.watchOut.length) out.push(`Weak spots and how to handle them:\n${brief.watchOut.map((w) => `- ${w}`).join("\n")}`);
  return out.join("\n\n");
}

/**
 * The prep as one text for the answer model, within `maxChars`. The brief and the user's goals
 * come first; the documents share what is left, so a long slide deck cannot crowd out the CV.
 */
export function prepContext(prep: Prep | null, maxChars: number): string {
  if (!prep || maxChars <= 0) return "";
  const head: string[] = [`Situation: ${KIND_ENGLISH[prep.kind]}${prep.title ? ` – ${prep.title}` : ""}`];
  if (prep.notes) head.push(`What the user wants to achieve or highlight:\n${prep.notes}`);
  if (prep.brief) head.push(`Prepared briefing:\n${briefText(prep.brief)}`);
  let text = head.join("\n\n");
  if (prep.docs.length === 0 && !prep.notes && !prep.brief) return "";
  if (text.length >= maxChars) return text.slice(0, maxChars);

  let room = maxChars - text.length;
  const shares = new Map<string, number>();
  // Code projects send their overview here; the parts matching each question go separately.
  const docs = prep.docs.map((d) => (d.kind === "code" ? { ...d, text: codeOverview(d.text, CODE_OVERVIEW_CHARS) } : d));
  const bySize = [...docs].sort((a, b) => a.text.length - b.text.length);
  bySize.forEach((d, i) => {
    const overhead = d.name.length + 12;
    const fair = Math.floor(room / (bySize.length - i)) - overhead;
    const take = Math.max(0, Math.min(d.text.length, fair));
    shares.set(d.id, take);
    room -= take + overhead;
  });
  for (const d of docs) {
    const take = shares.get(d.id) ?? 0;
    if (take <= 0) continue;
    text += `\n\n=== ${docLabel(d)} ===\n${d.text.slice(0, take)}${take < d.text.length ? " […]" : ""}`;
  }
  return text;
}

function docLabel(d: PrepDoc): string {
  if (d.kind === "web") return `${d.name} (webbsida${d.url ? `: ${d.url}` : ""})`;
  if (d.kind === "code") return `${d.name} (användarens kodprojekt)`;
  return d.name;
}

/** Prefixes every line of every file in a code document with its line number ("12| "). */
function numberCodeLines(text: string): string {
  const [overview, ...files] = text.split(FILE_MARK);
  return [
    overview,
    ...files.map((section) => {
      const newline = section.indexOf("\n");
      if (newline < 0) return section;
      const body = section
        .slice(newline + 1)
        .split("\n")
        .map((line, i) => `${i + 1}| ${line}`)
        .join("\n");
      return `${section.slice(0, newline)}\n${body}`;
    }),
  ].join(FILE_MARK);
}

/** Sent uncached with every deep answer, so kept to the few best-matching parts. */
const DEEP_SNIPPET_CHARS = 12_000;

/** How much of a long document stays in the deep answer's context when everything does not fit. */
const SHRUNK_DOC_CHARS = 10_000;

export interface DeepMaterial {
  context: string;
  snippets: string;
  /** Full texts of the documents shown only in part in `context`, for the answer's search tool. */
  library: Array<{ name: string; text: string }>;
}

/**
 * All of the prep for the deep answer: every document whole, code with line numbers. `context`
 * stays the same between questions so the model's prompt cache keeps it fast. Documents that do
 * not fit (largest first) shrink to their start or overview; `snippets` carries their parts that
 * match `query`, and `library` their full text so the answer can search all of it.
 */
export function deepMaterial(prep: Prep | null, maxChars: number, query: string): DeepMaterial {
  if (!prep || (prep.docs.length === 0 && !prep.notes)) return { context: "", snippets: "", library: [] };
  const head: string[] = [`Situation: ${KIND_ENGLISH[prep.kind]}${prep.title ? ` – ${prep.title}` : ""}`];
  if (prep.notes) head.push(`What the user wants to achieve or highlight:\n${prep.notes}`);
  if (prep.brief) head.push(`Prepared briefing:\n${briefText(prep.brief)}`);
  const blocks = new Map(prep.docs.map((d) => [d.id, `\n\n=== ${docLabel(d)} ===\n${d.kind === "code" ? numberCodeLines(d.text) : d.text}`]));
  const total = () => head.join("\n\n").length + [...blocks.values()].reduce((n, b) => n + b.length, 0);

  const shrunk: PrepDoc[] = [];
  for (const d of [...prep.docs].sort((a, b) => b.text.length - a.text.length)) {
    if (total() <= maxChars) break;
    const part =
      d.kind === "code"
        ? codeOverview(d.text, CODE_OVERVIEW_CHARS)
        : `${d.text.slice(0, SHRUNK_DOC_CHARS)}\n… (resten av dokumentet visas inte här; sök i materialet)`;
    if (part.length >= d.text.length) continue;
    blocks.set(d.id, `\n\n=== ${docLabel(d)} (visas bara delvis) ===\n${part}`);
    shrunk.push(d);
  }
  const context = (head.join("\n\n") + prep.docs.map((d) => blocks.get(d.id)).join("")).slice(0, maxChars);
  const ids = new Set(shrunk.map((d) => d.id));
  const snippets = shrunk.length ? materialSnippets(prep, query, DEEP_SNIPPET_CHARS, (d) => ids.has(d.id)) : "";
  return { context, snippets, library: shrunk.map((d) => ({ name: docLabel(d), text: d.text })) };
}

/** The documents for making a brief; code projects send their most telling part. */
export function briefDocs(prep: Prep): Array<{ name: string; text: string }> {
  return prep.docs.map((d) => ({
    name: docLabel(d),
    text: d.kind === "code" ? codeOverview(d.text, CODE_BRIEF_CHARS) : d.text,
  }));
}
